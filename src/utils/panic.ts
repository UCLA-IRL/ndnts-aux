export function panic(message: string) {
  const msgTest = `A critical error happened and the app has to reset: ${message}`;
  if (location) {
    // Runs in both the browser and deno, but the deno version will be blocking
    // So we do not use it.
    window.alert(msgTest);
    // Only runs in the browser
    const rootUrl = `${location.protocol}//${location.host}/`;
    location.replace(rootUrl);
  } else {
    console.error(msgTest);
    Deno.exit(0);
  }
}
