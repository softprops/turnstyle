import * as assert from "assert";
import { Waiter } from "../src/wait";

describe("wait", () => {
  describe("Waiter", () => {
    describe("wait", () => {
      it("will continue after a prescribed number of seconds", async () => {
        const messages: Array<string> = [];
        const waiter = new Waiter(
          () =>
            Promise.resolve({
              id: 1,
              status: "in_progress",
              html_url: ""
            }),
          1,
          1,
          (message: string) => {
            messages.push(message);
          }
        );
        assert.equal(await waiter.wait(), 1);
        assert.deepEqual(messages, [
          "✋Awaiting run ...",
          "🤙Exceeded wait seconds. Continuing..."
        ]);
      });

      it("will return when a run is completed", async () => {
        const messages: Array<string> = [];
        const waiter = new Waiter(
          () =>
            Promise.resolve({
              id: 1,
              status: "completed",
              html_url: ""
            }),
          1,
          1,
          (message: string) => {
            messages.push(message);
          }
        );
        assert.equal(await waiter.wait(), 0);
        assert.deepEqual(messages, ["👍 Run  complete."]);
      });
    });
  });
});
