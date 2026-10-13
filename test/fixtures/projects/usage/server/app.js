import express from 'express';
import e from 'express';

const app = express();
app.use(express.query());
app.use(e.json());

app.del('/items/:id', (req, res) => {
  res.sendfile('/tmp/x');
});

app.get('/ok', (req, res) => res.json({ ok: true }));
