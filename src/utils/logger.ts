export const logger = {
  info: (msg: any) => console.log(msg),
  warn: (msg: any) => console.warn(msg),
  error: (msg: any) => console.error(msg),
  debug: (msg: any) => console.log(msg)
};

export default logger;
