import { expect, test } from "bun:test";
import { createGame, joinPlayer } from "../sim/tick";
import { stateHash } from "./hash";

test("identical states hash identically; a moved player changes the hash", () => {
  const a = createGame(3),
    b = createGame(3);
  joinPlayer(a, { id: 0 });
  joinPlayer(b, { id: 0 });
  expect(stateHash(a)).toBe(stateHash(b));
  a.players.get(0)!.pos.x += 1;
  expect(stateHash(a)).not.toBe(stateHash(b));
});
