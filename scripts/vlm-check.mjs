import ZAI from 'z-ai-web-dev-sdk';
import fs from 'fs';

const [, , imgPath, question] = process.argv;
if (!imgPath || !question) {
  console.error('usage: node vlm-check.mjs <image.png> <question>');
  process.exit(1);
}
const zai = await ZAI.create();
const b64 = fs.readFileSync(imgPath).toString('base64');
const res = await zai.chat.completions.createVision({
  messages: [
    {
      role: 'user',
      content: [
        { type: 'text', text: question },
        { type: 'image_url', image_url: { url: `data:image/png;base64,${b64}` } },
      ],
    },
  ],
  thinking: { type: 'disabled' },
});
console.log(res.choices[0].message.content);
