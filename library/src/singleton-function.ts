import { dirname } from "node:path";
import {
  Code,
  type FunctionOptions,
  type Function as LambdaFunction,
  Runtime,
  SingletonFunction,
} from "aws-cdk-lib/aws-lambda";
import type { Construct } from "constructs/lib";

const handlerPath = dirname(
  require.resolve("@joaonmatos/custom-config-handler"),
);

export interface ConfigDeploymentSingletonFunctionProps
  extends FunctionOptions {
  readonly uuid: string;
  readonly lambdaPurpose?: string;
}

export class ConfigDeploymentSingletonFunction extends SingletonFunction {
  constructor(
    scope: Construct,
    id: string,
    props: ConfigDeploymentSingletonFunctionProps,
  ) {
    super(scope, id, {
      ...props,
      code: Code.fromAsset(handlerPath),
      handler: "index.handler",
      runtime: Runtime.NODEJS_20_X,
    });
    this.addMetadata("aws:cdk:is-custom-resource-handler-singleton", true);
    this.addMetadata(
      "aws:cdk:is-custom-resource-handler-runtime-family",
      this.runtime.family,
    );
    if (props?.logGroup) {
      this.logGroup.node.addMetadata(
        "aws:cdk:is-custom-resource-handler-logGroup",
        true,
      );
    }
    if (props?.logRetention) {
      const lambdaFunction = this._functionNode as unknown as LambdaFunction;
      lambdaFunction._logRetention?.node?.addMetadata(
        "aws:cdk:is-custom-resource-handler-logRetention",
        true,
      );
    }
  }
}
