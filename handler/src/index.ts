import { Logger } from "@aws-lambda-powertools/logger";
import {
  DeleteObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import type { CdkCustomResourceHandler } from "aws-lambda";
import toCamelCase from "camelize-ts";
import { z } from "zod";

const logger = new Logger();
const s3 = new S3Client();

const resourcePropertiesSchema = z
  .object({
    BucketName: z.string(),
    DestinationKey: z.string(),
    RetainOnDelete: z.boolean().default(false),
    ServiceToken: z.string(),
  })
  .and(z.record(z.unknown()));

type ResourceProperties = z.infer<typeof resourcePropertiesSchema>;

const parsedPropertiesSchema = resourcePropertiesSchema.transform(
  ({
    BucketName,
    DestinationKey,
    RetainOnDelete,
    Camelize,
    ServiceToken,
    ...rest
  }) => ({
    BucketName,
    DestinationKey,
    RetainOnDelete,
    data: toCamelCase(rest),
  }),
);

export const handler: CdkCustomResourceHandler<ResourceProperties> = async (
  event,
  context,
) => {
  logger.addContext(context);
  const physicalResourceId =
    event.RequestType === "Create"
      ? `cdk.publishedConfig.${crypto.randomUUID()}`
      : event.PhysicalResourceId;
  try {
    const req =
      event.RequestType === "Update"
        ? {
            ...event,
            ResourceProperties: parsedPropertiesSchema.parse(
              event.ResourceProperties,
            ),
            OldResourceProperties: resourcePropertiesSchema.parse(
              event.OldResourceProperties,
            ),
          }
        : {
            ...event,
            ResourceProperties: parsedPropertiesSchema.parse(
              event.ResourceProperties,
            ),
          };
    if (req.RequestType === "Delete") {
      const { RetainOnDelete, BucketName, DestinationKey } =
        req.ResourceProperties;
      if (!RetainOnDelete) {
        await deleteObject(BucketName, DestinationKey);
      }
    }
    if (req.RequestType === "Update") {
      const {
        ResourceProperties: {
          BucketName: newBucket,
          DestinationKey: newKey,
          RetainOnDelete,
        },
        OldResourceProperties: {
          BucketName: oldBucket,
          DestinationKey: oldKey,
        },
      } = req;
      if (!RetainOnDelete && (newBucket !== oldBucket || newKey !== oldKey)) {
        await deleteObject(oldBucket, oldKey);
      }
    }
    if (req.RequestType === "Create" || req.RequestType === "Update") {
      const { BucketName, DestinationKey, data } = req.ResourceProperties;
      await putObject(BucketName, DestinationKey, data);
    }
    return {
      PhysicalResourceId: physicalResourceId,
    };
  } catch (e) {
    logger.error("Failed to process event", {
      error: e,
    });
    throw e;
  }
};

async function deleteObject(bucketName: string, key: string) {
  logger.info("Deleting object", {
    bucketName,
    key,
  });
  await s3.send(
    new DeleteObjectCommand({
      Bucket: bucketName,
      Key: key,
    }),
  );
}

async function putObject(
  bucketName: string,
  key: string,
  data: Record<string, unknown>,
) {
  await s3.send(
    new PutObjectCommand({
      Bucket: bucketName,
      Key: key,
      Body: JSON.stringify(data),
      ContentType: "application/json",
    }),
  );
}
