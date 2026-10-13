import express from 'express';

const app = express();
app.use(express.json());

app.get('/health', (req, res) => {
  res.json({ ok: true });
});

app.post('/items', (req, res) => {
  const item = { id: 1, ...req.body };
  res.json(item, 201);
});

app.get('/items/:id', (req, res) => {
  const id = req.param('id');
  res.json({ id });
});

app.del('/items/:id', (req, res) => {
  res.sendStatus(204);
});

app.get('/report', (req, res) => {
  res.sendfile('/var/reports/latest.pdf');
});

export default app;
