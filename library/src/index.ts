import { dirname } from "node:path";
import { CustomResource, Duration } from "aws-cdk-lib";
import { Code, Function as Lambda, Runtime } from "aws-cdk-lib/aws-lambda";
import type { IBucket } from "aws-cdk-lib/aws-s3";
import { Provider } from "aws-cdk-lib/custom-resources";
import { Construct } from "constructs";

export interface ConfigDeploymentProps {
  readonly data: Record<string, unknown>;
  readonly destinationBucket: IBucket;
  readonly destinationKey: string;
  readonly retainOnDelete?: boolean;
}

export class ConfigDeployment extends Construct {
  readonly data: Record<string, unknown>;
  readonly destinationBucket: IBucket;
  readonly destinationKey: string;
  readonly retainOnDelete: boolean;

  constructor(scope: Construct, id: string, props: ConfigDeploymentProps) {
    super(scope, id);

    this.destinationBucket = props.destinationBucket;
    this.destinationKey = props.destinationKey;
    this.data = props.data;
    this.retainOnDelete = props.retainOnDelete ?? false;

    const handlerPath = dirname(
      require.resolve("@joaonmatos/custom-config-handler"),
    );
    const handler = new Lambda(this, "ConfigDeploymentProvisionHandler", {
      code: Code.fromAsset(handlerPath),
      handler: "index.handler",
      runtime: Runtime.NODEJS_20_X,
      memorySize: 256,
      timeout: Duration.seconds(60),
    });
    this.destinationBucket.grantReadWrite(handler);

    const provider = new Provider(this, "ConfigDeploymentFrameworkProvider", {
      onEventHandler: handler,
    });
    new CustomResource(this, "ConfigDeploymentCustomResource", {
      serviceToken: provider.serviceToken,
      resourceType: "Custom::CDKConfigDeployment",
      pascalCaseProperties: true,
      properties: {
        BucketName: this.destinationBucket.bucketName,
        DestinationKey: this.destinationKey,
        RetainOnDelete: props.retainOnDelete,
        ...this.data,
      },
    });
  }
}
