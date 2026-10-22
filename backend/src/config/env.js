/**
 * Загрузка переменных окружения из `.env`-файлов.
 *
 * Порядок: сначала корневой `.env` репозитория, затем `backend/.env`.
 * Поведение соответствует dotenv по умолчанию — уже заданные переменные
 * (в том числе проброшенные окружением/Docker) не перезаписываются.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const CONFIG_DIR = path.dirname(fileURLToPath(import.meta.url));

export const BACKEND_ROOT = path.resolve(CONFIG_DIR, '..', '..');
export const REPO_ROOT = path.resolve(BACKEND_ROOT, '..');

dotenv.config({ path: path.join(REPO_ROOT, '.env') });
dotenv.config({ path: path.join(BACKEND_ROOT, '.env') });

// Business-local dates are shared by API, SQLite and bot containers.
process.env.TZ ||= 'Europe/Moscow';
