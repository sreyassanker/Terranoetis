import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

import { prithviEngine } from './prithvi.ts';
import express from 'express';

const app = express();
app.use(express.json());

app.get('/api/fm/prithvi/status', async (req, res) => {
  const status = prithviEngine.getStatus();
  res.json({ status });
});

app.post('/api/fm/prithvi/analyze', async (req, res) => {
  const { lat, lon } = req.body;
  try {
    const result = await prithviEngine.analyze({ lat, lon });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.post('/api/fm/prithvi/change', async (req, res) => {
  const { lat, lon } = req.body;
  const result = await prithviEngine.detectChange(lat, lon);
  res.json(result);
});

await prithviEngine.init();
console.log('READY');
app.listen(3099, () => console.log('LISTENING'));
