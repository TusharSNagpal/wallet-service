import express, { NextFunction, Request, Response } from 'express';
import dotenv from 'dotenv';
import sequelize from './database';
import walletRoutes from './api/wallet/wallet.routes';

dotenv.config({ quiet: true });

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.use(walletRoutes);

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  res.status(400).json({ error: err.message });
});

const start = async () => {
  await sequelize.authenticate();

  console.log('database connected');

  app.listen(PORT, () => {
    console.log(`wallet-service running on port ${PORT}`);
  });
};

start().catch((err) => {
  console.error('failed to start:', err.message);
  process.exit(1);
});

export default app;
