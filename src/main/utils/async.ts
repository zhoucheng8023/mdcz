export const didPromiseTimeout = async (promise: Promise<unknown>, timeoutMs: number): Promise<boolean> => {
  if (timeoutMs <= 0) {
    return false;
  }

  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    const result = await Promise.race([
      promise.then(() => "settled" as const),
      new Promise<"timeout">((resolve) => {
        timer = setTimeout(() => resolve("timeout"), timeoutMs);
      }),
    ]);

    return result === "timeout";
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
};
