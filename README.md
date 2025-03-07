## Install
npm install

## Deploy
> [!NOTE]
> You need [AWS credentials](https://www.serverless.com/framework/docs/providers/aws/guide/credentials) to run the following commands

```
npx serverless deploy
```

## Invoke locally
npx serverless invoke local --function counter --path test/event.json
