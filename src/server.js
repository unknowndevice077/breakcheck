import express from 'express';

const app = express();
app.use(express.json());

const items = new Map();

app.get('/items/:id', (req, res) => {
  const item = items.get(req.param('id'));
  if (!item) return res.json({ error: 'not found' }, 404);
  res.json(item);
});

app.del('/items/:id', (req, res) => {
  items.delete(req.params.id);
  res.sendStatus(204);
});

app.get('/export', (req, res) => {
  res.sendfile('/tmp/export.csv');
});

app.listen(3000, () => console.log('listening on :3000'));
