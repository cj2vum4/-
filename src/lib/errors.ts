export type GameErrorCode =
  | "SESSION_NOT_FOUND"
  | "SESSION_EXISTS"
  | "SESSION_CLOSED"
  | "JOIN_CLOSED"
  | "BAD_REQUEST"
  | "BAD_DATE"
  | "UNAUTHORIZED"
  | "PLAYER_NOT_FOUND"
  | "NAME_TAKEN";

const STATUS: Record<GameErrorCode, number> = {
  SESSION_NOT_FOUND: 404,
  SESSION_EXISTS: 409,
  SESSION_CLOSED: 409,
  JOIN_CLOSED: 409,
  BAD_REQUEST: 400,
  BAD_DATE: 400,
  UNAUTHORIZED: 401,
  PLAYER_NOT_FOUND: 404,
  NAME_TAKEN: 409,
};

export class GameError extends Error {
  constructor(
    readonly code: GameErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "GameError";
  }

  get status(): number {
    return STATUS[this.code];
  }
}
