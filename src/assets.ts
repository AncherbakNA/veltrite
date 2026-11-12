export const assetUrl = (path: string) =>
  "veltrite-asset://vault/" + path.split("/").map(encodeURIComponent).join("/");
