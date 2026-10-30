// /members#member-… 로 들어오거나 해시가 바뀌면 그 멤버 줄을 펼친다(수상 페이지의 멤버 링크).
const openFromHash = () => {
  const id = decodeURIComponent(location.hash.slice(1));
  const el = id ? document.getElementById(id) : null;
  if (el instanceof HTMLDetailsElement) el.open = true;
};
openFromHash();
addEventListener('hashchange', openFromHash);
