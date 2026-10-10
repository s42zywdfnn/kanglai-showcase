// 接入真实 API 时只需替换此读取层，并保持 dashboard.json 的字段语义。
export async function readDashboard() {
  const response = await fetch('data/dashboard.json', {cache:'no-store'});
  if (!response.ok) throw new Error('数据读取失败');
  const data = await response.json();
  if (data.schemaVersion !== 1) throw new Error('数据结构版本不匹配');
  return data;
}

export async function readProvinceGeometry() {
  const response = await fetch('assets/china-provinces.json');
  if (!response.ok) throw new Error('地图读取失败');
  return response.json();
}
