import { StyleTextToSpeech2Model, AutoTokenizer, Tensor } from '@huggingface/transformers';
const m = await import('@huggingface/transformers');
m.env.remoteHost = 'https://hf-mirror.com';
const { StyleTextToSpeech2Model: S, AutoTokenizer: A, Tensor: T } = m;
const model = await S.from_pretrained('onnx-community/Kokoro-82M-v1.0-ONNX', { dtype: 'fp32' });
const tok = await A.from_pretrained('onnx-community/Kokoro-82M-v1.0-ONNX');
const ids = tok('hello world', { truncation: true });
const style = new Float32Array(256);
const styleTensor = new T('float32', style, [1, 256]);
const speedTensor = new T('float32', [1], [1]);
const inputs = { input_ids: ids.input_ids, style: styleTensor, speed: speedTensor };
const out = await model(inputs);
const w = out.waveform;
console.log('dims:', w.dims);
console.log('dataLength:', w.data.length);
console.log('dataType:', w.data.constructor.name);
// Try to access via array indexing
console.log('sample 0:', w.data[0]);
console.log('sample 10:', w.data[10]);
