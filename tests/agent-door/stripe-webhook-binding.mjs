// This journey performs no inbound webhook; native configuration still gets
// a fresh disposable signing value rather than a committed credential literal.
export default () => `whsec_${crypto.randomUUID().replaceAll('-', '')}`;
