export function convertListToMap<T>(fetchedData: T[], addresses: string[]) {
  const result: Record<string, T> = {};
  fetchedData.forEach((data, index) => {
    if (data) {
      const addr = addresses[index];
      result[addr] = data;
    }
  });
  return result;
}
