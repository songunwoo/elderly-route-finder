let map;
let ps;
let currentPolyline = null;
let currentMarkers = [];
let lastSearchData = null; // 검색 결과 데이터 저장용
let currentOrigin = null;
let currentDestination = null;

window.onload = function() {
  if (typeof kakao !== 'undefined' && kakao.maps) {
    const mapContainer = document.getElementById('map');
    const mapOptions = {
      center: new kakao.maps.LatLng(37.5665, 126.9780),
      level: 5
    };
    
    map = new kakao.maps.Map(mapContainer, mapOptions);
    ps = new kakao.maps.services.Places();
  } else {
    alert('카카오 지도 SDK를 불러오지 못했습니다.');
  }
};

function searchPlace(keyword) {
  return new Promise((resolve, reject) => {
    if (!ps) {
      reject('지도 서비스가 아직 준비되지 않았습니다.');
      return;
    }

    ps.keywordSearch(keyword, (data, status) => {
      if (status === kakao.maps.services.Status.OK) {
        resolve({
          name: data[0].place_name,
          x: data[0].x,
          y: data[0].y
        });
      } else {
        reject(`'${keyword}' 장소를 찾을 수 없습니다.`);
      }
    });
  });
}

async function searchRoute() {
  const originName = document.getElementById('origin').value.trim();
  const destName = document.getElementById('destination').value.trim();
  const transportType = document.getElementById('transportType').value;

  if (!originName || !destName) {
    alert('출발지와 도착지를 모두 입력해주세요.');
    return;
  }

  try {
    currentOrigin = await searchPlace(originName);
    currentDestination = await searchPlace(destName);

    const profile = {
      stairs: document.getElementById('stairs').checked,
      slope: document.getElementById('slope').checked,
      longWalk: document.getElementById('longWalk').checked,
      crowded: document.getElementById('crowded').checked,
    };

    const response = await fetch('https://songunwoo.github.io/elderly-route-finder/api/routes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        origin: currentOrigin, 
        destination: currentDestination, 
        transportType, 
        profile 
      })
    });

    if (!response.ok) throw new Error('백엔드 서버 연동 실패');

    lastSearchData = await response.json();
    
    renderResults(lastSearchData);
    
    // 기본적으로 난이도가 가장 낮아 추천된 경로(첫 번째 경로)를 지도에 표시
    selectRoute(0);

  } catch (error) {
    alert(error);
  }
}

// 사용자가 경로 카드를 클릭했을 때 실행되는 함수
function selectRoute(index) {
  if (!lastSearchData || !lastSearchData.routes[index]) return;

  const selectedRoute = lastSearchData.routes[index];
  
  // 모든 카드의 선택 스타일 해제 후 클릭한 카드만 활성화
  const cards = document.querySelectorAll('.route-card');
  cards.forEach((card, idx) => {
    if (idx === index) {
      card.classList.add('active');
    } else {
      card.classList.remove('active');
    }
  });

  // 지도에 선택된 경로 그리기
  drawRouteOnMap(selectedRoute, currentOrigin, currentDestination);
}

function drawRouteOnMap(route, origin, destination) {
  if (currentPolyline) currentPolyline.setMap(null);
  currentMarkers.forEach(marker => marker.setMap(null));
  currentMarkers = [];

  const originPoint = new kakao.maps.LatLng(origin.y, origin.x);
  const destPoint = new kakao.maps.LatLng(destination.y, destination.x);

  const originMarker = new kakao.maps.Marker({ position: originPoint, map: map });
  const destMarker = new kakao.maps.Marker({ position: destPoint, map: map });
  currentMarkers.push(originMarker, destMarker);

  const linePath = route.path.map(pt => new kakao.maps.LatLng(pt.lat, pt.lng));

  // 추천 경로는 녹색, 사용자가 직접 다른 경로를 누르면 파란색 계열로 구별
  const routeColor = route.isRecommended ? '#28a745' : '#007bff';

  currentPolyline = new kakao.maps.Polyline({
    path: linePath,
    strokeWeight: 6,
    strokeColor: routeColor,
    strokeOpacity: 0.8,
    strokeStyle: 'solid'
  });

  currentPolyline.setMap(map);

  const bounds = new kakao.maps.LatLngBounds();
  bounds.extend(originPoint);
  bounds.extend(destPoint);
  map.setBounds(bounds);
}

function renderResults(data) {
  const container = document.getElementById('routeList');
  container.innerHTML = '';

  data.routes.forEach((route, index) => {
    const card = document.createElement('div');
    card.className = `route-card ${route.isRecommended ? 'recommended' : ''}`;
    // 카드 클릭 이벤트 추가
    card.setAttribute('onclick', `selectRoute(${index})`);
    
    card.innerHTML = `
      <h4>${route.isRecommended ? '⭐ 추천 - ' : ''}${route.name}</h4>
      <p>소요 시간: <strong>${route.time}분</strong> | 거리: ${(route.distance / 1000).toFixed(1)}km</p>
      <p>이동 난이도 점수: <strong style="color: ${route.difficulty > 50 ? '#dc3545' : '#28a745'}">${route.difficulty}/100</strong></p>
    `;
    container.appendChild(card);
  });

  const reasonBox = document.createElement('div');
  reasonBox.style.cssText = 'background: #e9f7ef; padding: 10px; border-radius: 5px; margin-top: 10px; font-size: 13px; color: #155724;';
  reasonBox.innerHTML = `<strong>💡 추천 이유:</strong> ${data.recommendationReason}`;
  container.appendChild(reasonBox);
}
