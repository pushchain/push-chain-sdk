import dotenv from 'dotenv';
import path from 'path';

// Single dotenv load — all test files import this instead of calling dotenv.config()
dotenv.config({ path: path.resolve(__dirname, '../../.env') });
