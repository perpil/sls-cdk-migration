'use strict';
import createAPI from 'lambda-api';
const DEFAULT_SERVICE_NAME = 'migration-sandbox-api';

import { Metrics, MetricUnit } from '@aws-lambda-powertools/metrics';
import { statSync } from 'fs';

const VERSION = process.env.AWS_LAMBDA_FUNCTION_VERSION;
const REGION = process.env.AWS_REGION || 'us-west-2';
const api = createAPI({
  logger: { stack: true, access: 'never' },
  errorHeaderWhitelist: ['requestid'],
});

import {
  DynamoDBClient, UpdateItemCommand,
} from '@aws-sdk/client-dynamodb';
const metrics = new Metrics({
  namespace: 'migration-sandbox/api',
  serviceName: DEFAULT_SERVICE_NAME,
});

let ddbClient = new DynamoDBClient({ region: REGION });

let RUNTIME,
  SIZE;

// Get Lambda Runtime Creation Timestamp
try {
  const stats = statSync('/var/runtime');
  RUNTIME = stats.mtime;
} catch (err) {
  console.error('Unable to determine runtime creation date', err);
}

// Get Lambda Bundle Size
try {
  const stats = statSync('handler.js');
  SIZE = stats.size;
} catch (err) {
  console.error('Unable to determine file size', err);
}

api.get('/*', async (req, res) => {
   const uic = new UpdateItemCommand({
     TableName: 'migration-sandbox-table',
     Key: {
       'key': { S: 'counter' }
     },
     ExpressionAttributeNames:{'#cnt': 'count'},
     ExpressionAttributeValues: { ':val': { "N": "1" } },
     ReturnValues:"UPDATED_NEW",
     UpdateExpression:"ADD #cnt :val",
   });
  const result = await ddbClient.send(uic);
  return {
    status: 200,
    message: 'Counter incremented',
    count: result.Attributes.count.N
  };
});

api.finally((req, res) => {
  metrics.addMetadata('node', process.version);
  metrics.addMetadata('runtime', RUNTIME);
  metrics.addMetadata('requestId', req.id);
  metrics.addDimension('route', req.route || 'unknown');
  res.header('requestid', req.id);
  metrics.addMetadata('startTime', req._start);
  metrics.addMetadata('coldStart', req.coldStart);
  metrics.addMetadata('version', VERSION);
  metrics.addMetadata('awsSdk', process.env.awsSdk);
  metrics.addMetadata('bundleSize', SIZE);

  if (res._response.statusCode >= 400 && res._response.statusCode < 500) {
    let error = undefined;
    try {
      error = JSON.parse(res._response.body).error;
    } catch (err) {}
    error = error || res._response.body;
    metrics.addMetadata('errorDetails', error);
  }
  metrics.addMetric(
    'error',
    MetricUnit.Count,
    res._response.statusCode >= 400 &&
      res._response.statusCode < 500 &&
      res._response.statusCode != 409
      ? 1.0
      : 0.0
  );
  metrics.addMetric(
    'fault',
    MetricUnit.Count,
    res._response.statusCode >= 500 ? 1.0 : 0.0
  );
  metrics.addMetadata('statusCode', res._response.statusCode);
  const latency = Date.now() - req._start;
  metrics.addMetric('latency', MetricUnit.Milliseconds, latency);
  metrics.addMetadata('remainingTime', req.context.getRemainingTimeInMillis());
  metrics.publishStoredMetrics();
});

export async function router(event, context) {
  metrics.addMetadata('ip', event.requestContext.http?.sourceIp || event.requestContext.identity?.sourceIp || 'unknown');
  metrics.addMetadata('path', event.path);
  metrics.addMetadata('method', event.httpMethod);
  metrics.addMetadata('userAgent', event.headers['User-Agent'] || event.requestContext.identity?.userAgent ||'unknown');
  return await api.run(event, context);
}
