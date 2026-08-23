let map;
let ps;
let currentPolyline = null;
let currentMarkers = [];
let facilityMarkers = []; // 주변 시설 마커 저장 배열
let userLocationMarker = null; // 사용자 현재 위치 마커

let lastSearchData = null;
let currentOrigin = null;
let currentDestination = null;
let userCoords = null; // { lat, lng } 사용자 GPS 좌표

window.onload = function() {
  if (typeof kakao !== 'undefined' && kakao.maps) {
    const mapContainer = document.getElementById('map');
    const mapOptions = {
      center: new kakao.maps.LatLng(37.5665, 126.9780),
      level: 5
    };
    
    map = new kakao.maps.Map(mapContainer, mapOptions);
    ps = new kakao.maps.services.Places();

    // 페이지 접속 시 사용자 위치 자동 검색
    initUserLocation();
  } else {
    alert('카카오 지도 SDK를 불러오지 못했습니다.');
  }
};

// 사용자 GPS 위치 조회 및 지도 표시
function initUserLocation() {
  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const lat = position.coords.latitude;
        const lng = position.coords.longitude;
        userCoords = { lat, lng };

        const locPosition = new kakao.maps.LatLng(lat, lng);
        map.setCenter(locPosition);

        // 현재 위치 빨간색 마커 아이콘 표시
        if (userLocationMarker) userLocationMarker.setMap(null);
        userLocationMarker = new kakao.maps.Marker({
          map: map,
          position: locPosition
        });

        // 현재 위치 인포윈도우
        const infowindow = new kakao.maps.InfoWindow({
          content: '<div style="padding:5px;font-size:12px;font-weight:bold;">📍 현재 내 위치</div>'
        });
        infowindow.open(map, userLocationMarker);
      },
      (error) => {
        console.warn('GPS 위치를 가져올 수 없습니다.', error.message);
      }
    );
  }
}

// 내 위치로 지도 이동
function moveToCurrentLocation() {
  if (!userCoords) {
    alert('현재 GPS 위치 정보를 불러오는 중이거나 권한이 거부되었습니다.');
    initUserLocation();
    return;
  }
  const locPosition = new kakao.maps.LatLng(userCoords.lat, userCoords.lng);
  map.setCenter(locPosition);
  map.setLevel(4);
}

// 출발지에 현재 위치 입력
function setOriginToCurrentLocation() {
  if (!userCoords) {
    alert('현재 위치 정보를 가져오지 못했습니다. GPS 권한을 확인해주세요.');
    return;
  }
  document.getElementById('origin').value = '현재 위치';
  currentOrigin = {
    name: '현재 위치',
    x: userCoords.lng.toString(),
    y: userCoords.lat.toString()
  };
}

// 주변 시설 검색 (반경 1.5km = 1500m)
function searchNearbyFacilities(type) {
  clearFacilityMarkers();

  // 검색 중심점 (현재 GPS 위치가 있으면 GPS 중심, 없으면 지도 현재 중심)
  const center = userCoords 
    ? new kakao.maps.LatLng(userCoords.lat, userCoords.lng)
    : map.getCenter();

  const options = {
    location: center,
    radius: 1500 // 1.5km 반경
  };

  if (type === 'medical') {
    // 의료 및 보건 시설: 카테고리 검색 (HP8: 병원, PM9: 약국)
    ps.categorySearch('HP8', (data, status) => displayFacilityResults(data, status, '🏥'), options);
    ps.categorySearch('PM9', (data, status) => displayFacilityResults(data, status, '💊'), options);
  } else if (type === 'senior') {
    // 노인 복지 시설 키워드 검색
    ps.keywordSearch('경로당', (data, status) => displayFacilityResults(data, status, '👵'), options);
    ps.keywordSearch('노인복지관', (data, status) => displayFacilityResults(data, status, '🏢'), options);
    ps.keywordSearch('노인주간보호센터', (data, status) => displayFacilityResults(data, status, '🏥'), options);
  }
}

// 검색된 주변 시설 마커 생성
function displayFacilityResults(data, status, iconEmoji) {
  if (status === kakao.maps.services.Status.OK) {
    data.forEach(place => {
      const position = new kakao.maps.LatLng(place.y, place.x);
      const marker = new kakao.maps.Marker({
        map: map,
        position: position
      });

      const infowindow = new kakao.maps.InfoWindow({
        content: `<div style="padding:5px;font-size:12px;">${iconEmoji} <strong>${place.place_name}</strong><br><span style="color:#666;font-size:11px;">${place.road_address_name || place.address_name}</span></div>`
      });

      kakao.maps.event.addListener(marker, 'mouseover', () => infowindow.open(map, marker));
      kakao.maps.event.addListener(marker, 'mouseout', () => infowindow.close());

      facilityMarkers.push(marker);
    });
  }
}

// 시설 마커 지우기
function clearFacilityMarkers() {
  facilityMarkers.forEach(marker => marker.setMap(null));
  facilityMarkers = [];
}

function searchPlace(keyword) {
  return new Promise((resolve, reject) => {
    if (!ps) {
      reject('지도 서비스가 아직 준비되지 않았습니다.');
      return;
    }

    // 현재 위치로 출발지가 설정되어 이미 좌표가 입력되어 있는 경우
    if (keyword === '현재 위치' && currentOrigin) {
      resolve(currentOrigin);
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

    const response = await fetch('https://elderlyroutefinder.onrender.com/api/routes', {
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
    selectRoute(0);

  } catch (error) {
    alert(error);
  }
}

function selectRoute(index) {
  if (!lastSearchData || !lastSearchData.routes[index]) return;

  const selectedRoute = lastSearchData.routes[index];
  
  const cards = document.querySelectorAll('.route-card');
  cards.forEach((card, idx) => {
    if (idx === index) {
      card.classList.add('active');
    } else {
      card.classList.remove('active');
    }
  });

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
  reasonBox.innerHTML = `<strong>💡 안내:</strong> ${data.recommendationReason}`;
  container.appendChild(reasonBox);
}
