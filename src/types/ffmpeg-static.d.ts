/**
 * Os tipos publicados pelo `ffmpeg-static` usam `export default`, mas o pacote é
 * CommonJS e faz `module.exports = <caminho>`. Sob `module: NodeNext` isso faria
 * o import default resolver para o objeto de módulo em vez da string.
 */
declare module 'ffmpeg-static' {
  const ffmpegPath: string | null;
  export = ffmpegPath;
}
