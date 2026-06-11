export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  try {
    const { audio } = req.body;
    const buffer = Buffer.from(audio, 'base64');
    const { FormData } = await import('formdata-node');
    const { Blob } = await import('buffer');
    const form = new FormData();
    form.append('file', new Blob([buffer], { type: 'audio/webm' }), 'audio.webm');
    form.append('model', 'whisper-1');
    form.append('language', 'pt');
    const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.VITE_OPENAI_KEY}` },
      body: form,
    });
    const data = await response.json();
    res.status(200).json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
