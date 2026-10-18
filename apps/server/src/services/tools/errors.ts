/** Kullanıcıya/modele gösterilmesi güvenli, kısa bir araç hatası. */
export class ToolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ToolError';
  }
}
