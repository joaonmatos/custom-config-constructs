import { CustomResource, Duration, Token } from "aws-cdk-lib";
import type { IDistribution } from "aws-cdk-lib/aws-cloudfront";
import type { IRole } from "aws-cdk-lib/aws-iam";
import type { ILogGroup, RetentionDays } from "aws-cdk-lib/aws-logs";
import { Bucket, type IBucket } from "aws-cdk-lib/aws-s3";
import { pascal } from "case";
import { Construct } from "constructs";
import { ConfigDeploymentSingletonFunction } from "./singleton-function";

export interface ConfigDeploymentProps {
  readonly data: Record<string, unknown>;
  readonly destinationBucket: IBucket;
  readonly destinationKey: string;
  readonly retainOnDelete?: boolean;
  readonly distribution?: IDistribution;
  readonly distributionPath?: string;
  readonly logGroup?: ILogGroup;
  readonly memoryLimit?: number;
  readonly role?: IRole;
  readonly pascalize?: boolean;
  readonly camelize?: boolean;
}

export class ConfigDeployment extends Construct {
  private _deployedBucket: IBucket;
  private readonly destinationBucket: IBucket;
  private readonly destinationKey: string;
  private readonly data: Record<string, unknown>;

  /**
   * Execution role of the Lambda function behind the custom CloudFormation resource of type `Custom::CDKConfigDeployment`.
   */
  public readonly handlerRole: IRole;

  constructor(scope: Construct, id: string, props: ConfigDeploymentProps) {
    super(scope, id);

    if (props.distributionPath) {
      if (!props.distribution) {
        throw new Error(
          "Distribution must be specified if distribution path is specified",
        );
      }
      if (
        !Token.isUnresolved(props.distributionPath) ||
        !props.distributionPath?.startsWith("/")
      ) {
        throw new Error('Distribution paths must start with "/"');
      }
    }

    this.destinationBucket = props.destinationBucket;
    this.destinationKey = props.destinationKey;
    this.data = props.data;

    const handler = new ConfigDeploymentSingletonFunction(
      this,
      "CustomResourceHandler",
      {
        uuid: this.renderSingletonUuid(props.memoryLimit),
        lambdaPurpose: "Custom::CDKConfigDeployment",
        timeout: Duration.minutes(1),
        role: props.role,
        memorySize: props.memoryLimit,
        logGroup: props.logGroup,
      },
    );

    const handlerRole = handler.role;
    if (!handlerRole) {
      throw new Error("lambda.SingletonFunction should have created a Role");
    }
    this.handlerRole = handlerRole;

    this.destinationBucket.grantReadWrite(handler);
    props.distribution?.grant(
      handler,
      "cloudfront:CreateInvalidation",
      "cloudfront:GetInvalidation",
    );

    const crUniqueId = `CustomResource${this.renderUniqueId(props.memoryLimit)}`;
    new CustomResource(this, crUniqueId, {
      serviceToken: handler.functionArn,
      resourceType: "Custom::CDKConfigDeployment",
      properties: {
        BucketName: this.destinationBucket.bucketName,
        DestinationKey: this.destinationKey,
        RetainOnDelete: props.retainOnDelete,
        DistributionId: props.distribution?.distributionId,
        DistributionPath: props.distributionPath,
        Camelize: props.camelize,
        ...(props.pascalize ? pascalObject(this.data) : this.data),
      },
    });
  }

  public get deployedBucket(): IBucket {
    this._deployedBucket =
      this._deployedBucket ??
      Bucket.fromBucketName(
        this,
        "DestinationBucket",
        this.destinationBucket.bucketName,
      );
    return this._deployedBucket;
  }

  private renderUniqueId(memoryLimit?: number) {
    let uuid = "";
    // if the user specifes a custom memory limit, we define another singleton handler
    // with this configuration. otherwise, it won't be possible to use multiple
    // configurations since we have a singleton.
    if (memoryLimit) {
      if (Token.isUnresolved(memoryLimit)) {
        throw new Error(
          "Can't use tokens when specifying 'memoryLimit' since we use it to identify the singleton custom resource handler.",
        );
      }

      uuid += `-${memoryLimit.toString()}MiB`;
    }
    return uuid;
  }

  private renderSingletonUuid(memoryLimit?: number) {
    let uuid = "4742745F-9DE9-4CF6-A516-A661706F63F0";
    uuid += this.renderUniqueId(memoryLimit);
    return uuid;
  }
}

function pascalObject(obj: Record<string, unknown>): Record<string, unknown> {
  const entries = Object.entries(obj).map(([k, v]) => [pascal(k), v] as const);
  return Object.fromEntries(entries);
}
