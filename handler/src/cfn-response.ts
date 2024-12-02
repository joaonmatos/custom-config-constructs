import type { CloudFormationCustomResourceEvent, Context } from 'aws-lambda'
import { logger } from './logger.js'

export const SUCCESS = 'SUCCESS'
export const FAILED = 'FAILED'

export interface SendProps<T> {
  event: CloudFormationCustomResourceEvent<T>
  context: Context
  responseStatus: typeof SUCCESS | typeof FAILED
  physicalResourceId?: string
  reason?: string
}

export async function send<T>({
  event,
  context,
  responseStatus,
  physicalResourceId,
  reason,
}: SendProps<T>) {
  logger.info('Sending response to CloudFormation', {
    status: responseStatus,
    reason,
  })
  const responseBody = JSON.stringify({
    Status: responseStatus,
    Reason:
      reason ??
      `See the details in CloudWatch Log Stream: ${context.logStreamName}`,
    PhysicalResourceId: physicalResourceId ?? context.logStreamName,
    StackId: event.StackId,
    RequestId: event.RequestId,
    LogicalResourceId: event.LogicalResourceId,
    NoEcho: false,
  })
  const { hostname, pathname } = new URL(event.ResponseURL)
  try {
    const res = await fetch(`https://${hostname}/${pathname}`, {
      method: 'PUT',
      body: responseBody,
      headers: {
        'content-type': '',
        'content-length': responseBody.length.toString(),
      },
    })
    logger.info('Got response from CloudFormation', {
      statusCode: res.status,
    })
  } catch (e) {
    logger.error('Failed executing request', {
      error: e,
    })
  }
}
