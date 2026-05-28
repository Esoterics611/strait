import 'reflect-metadata';
import { DataSource } from 'typeorm';
import * as dotenv from 'dotenv';

dotenv.config();

export const AppDataSource = new DataSource({
  type: 'postgres',
  url: process.env['DATABASE_URL'],
  synchronize: false,
  logging: process.env['NODE_ENV'] !== 'production',
  entities: [],
  migrations: ['migrations/*.ts'],
  migrationsTableName: 'typeorm_migrations',
});
