export default () => ({
  port: parseInt(process.env.PORT ?? '3000', 10),
  nodeEnv: process.env.NODE_ENV ?? 'development',

  mongodb: {
    uri: process.env.MONGODB_URI ?? '',
  },

  redis: {
    url: process.env.REDIS_URL ?? '',           // preferred: full URL e.g. rediss://... (Upstash)
    host: process.env.REDIS_HOST ?? 'localhost', // fallback for local dev
    port: parseInt(process.env.REDIS_PORT ?? '6379', 10),
  },

  jwt: {
    secret: process.env.JWT_SECRET ?? '',
    expiresIn: process.env.JWT_EXPIRES_IN ?? '1h',
    refreshSecret: process.env.JWT_REFRESH_SECRET ?? '',
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN ?? '7d',
  },

  encryption: {
    key: process.env.ENCRYPTION_KEY ?? '',
  },

  email: {
    resendApiKey: process.env.RESEND_API_KEY ?? '',
    from: process.env.EMAIL_FROM ?? 'noreply@clm.io',
  },

  frontendUrl: process.env.FRONTEND_URL ?? 'http://localhost:3001',

  mistral: {
    apiKey: process.env.MISTRAL_API_KEY ?? '',
    chatModel: process.env.MISTRAL_CHAT_MODEL ?? 'mistral-large-latest',
  },
});
