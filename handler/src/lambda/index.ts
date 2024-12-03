import {
  CloudFrontClient,
  CreateInvalidationCommand,
  waitUntilInvalidationCompleted,
} from '@aws-sdk/client-cloudfront'
import {
  DeleteObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3'
import type { CloudFormationCustomResourceHandler } from 'aws-lambda'
import toCamelCase from 'camelize-ts'
import { z } from 'zod'
import { FAILED, SUCCESS, send } from './cfn-response.js'
import { logger } from './logger.js'

const resourcePropertiesSchema = z
  .object({
    BucketName: z.string(),
    DestinationKey: z.string(),
    RetainOnDelete: z.boolean().default(false),
    DistributionId: z.string().optional(),
    DistributionPath: z.string().optional(),
    Camelize: z.boolean().default(true),
  })
  .and(z.record(z.unknown()))

type ResourceProperties = z.infer<typeof resourcePropertiesSchema>

const parsedPropertiesSchema = resourcePropertiesSchema
  .refine(
    ({ DistributionId, DistributionPath }) =>
      DistributionId || !DistributionPath,
    'DistributionPath can only exist if DistributionId exists.',
  )
  .transform(
    ({
      BucketName,
      DestinationKey,
      RetainOnDelete,
      DistributionId,
      DistributionPath,
      Camelize,
      ...rest
    }) => ({
      BucketName,
      DestinationKey,
      RetainOnDelete,
      DistributionId,
      DistributionPath,
      data: Camelize ? toCamelCase(rest) : rest,
    }),
  )

const s3 = new S3Client()
const cf = new CloudFrontClient()

export const handler: CloudFormationCustomResourceHandler<
  ResourceProperties
> = async (event, context) => {
  logger.addContext(context)
  const physicalResourceId =
    event.RequestType === 'Create'
      ? `cdk.publishedConfig.${crypto.randomUUID()}`
      : event.PhysicalResourceId
  try {
    const req =
      event.RequestType === 'Update'
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
          }
    if (req.RequestType === 'Delete') {
      const { RetainOnDelete, BucketName, DestinationKey } =
        req.ResourceProperties
      if (!RetainOnDelete) {
        await deleteObject(BucketName, DestinationKey)
      }
    }
    if (req.RequestType === 'Update') {
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
      } = req
      if (!RetainOnDelete && (newBucket !== oldBucket || newKey !== oldKey)) {
        await deleteObject(oldBucket, oldKey)
      }
    }
    if (req.RequestType === 'Create' || req.RequestType === 'Update') {
      const { BucketName, DestinationKey, data } = req.ResourceProperties
      await putObject(BucketName, DestinationKey, data)
    }
    const { DistributionId, DistributionPath, DestinationKey } =
      req.ResourceProperties
    if (DistributionId) {
      await invalidateCloudfront(
        DistributionId,
        DistributionPath ?? DestinationKey,
      )
    }
    await send({
      event,
      context,
      responseStatus: SUCCESS,
      physicalResourceId,
    })
  } catch (e) {
    logger.error('Failed to process event', {
      error: e,
    })
    await send({
      event,
      context,
      responseStatus: FAILED,
      physicalResourceId,
      reason: e instanceof Error ? e.message : undefined,
    })
  }
}

async function deleteObject(bucketName: string, key: string) {
  logger.info('Deleting object', {
    bucketName,
    key,
  })
  await s3.send(
    new DeleteObjectCommand({
      Bucket: bucketName,
      Key: key,
    }),
  )
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
      ContentType: 'application/json',
    }),
  )
}

async function invalidateCloudfront(distributionId: string, path: string) {
  const res = await cf.send(
    new CreateInvalidationCommand({
      DistributionId: distributionId,
      InvalidationBatch: {
        Paths: {
          Quantity: 1,
          Items: [path],
        },
        CallerReference: crypto.randomUUID(),
      },
    }),
  )

  await waitUntilInvalidationCompleted(
    { client: cf, maxWaitTime: 10 },
    {
      DistributionId: distributionId,
      Id: res.Invalidation?.Id,
    },
  )
}
