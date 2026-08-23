require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.use(cors());
app.use(express.json());

// 1. 현재 폴더의 정적 파일(index.html, style.css, app.js 등) 제공
app.use(express.static(__dirname));

// Supabase 클라이언트 생성
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// 이동 수단별 평균 속도 및 대기시간 기반 소요 시간(분) 계산 함수
function calculateBaseDuration(distanceMeters, transportType) {
  let minutes = 0;

  switch (transportType) {
    case 'walk':
      // 노약자 기준 보행 속도 (약 3 km/h = 분당 50m)
      minutes = Math.round(distanceMeters / 50);
      break;
    case 'bus':
      // 시내버스 평균 속도 (분당 250m) + 정류장 대기시간 7분
      minutes = Math.round(distanceMeters / 250) + 7;
      break;
    case 'subway':
      // 지하철 평균 속도 (분당 500m) + 역 이동 및 대기시간 10분
      minutes = Math.round(distanceMeters / 500) + 10;
      break;
    case 'transit':
    default:
      // 버스+지하철 혼합 (분당 333m) + 환승 대기시간 6분
      minutes = Math.round(distanceMeters / 333) + 6;
      break;
  }

  return Math.max(minutes, 2); // 최소 2분 보장
}

// 이동 제약 난이도 점수 계산
function calculateDifficulty(route, profile, transportType) {
  let score = 20;

  if (transportType === 'walk') {
    if (profile.longWalk) score += Math.floor(route.distance / 200) * 8;
  } else if (profile.longWalk && route.distance > 500) {
    score += Math.floor((route.distance - 500) / 100) * 5;
  }

  if (profile.stairs && route.hasStairs) score += 30;
  if (profile.slope && route.hasSlope) score += 20;

  return Math.min(score, 100);
}

// 메인 루트 요청 시 index.html 보냄
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// 경로 검색 API
app.post('/api/routes', async (req, res) => {
  try {
    const { origin, destination, transportType, profile } = req.body;

    // Supabase에 검색 이력 저장
    await supabase.from('profiles').insert([{
      stairs_difficult: profile.stairs,
      slope_difficult: profile.slope,
      long_walk_difficult: profile.longWalk,
      crowded_difficult: profile.crowded
    }]);

    let pathCoordinates = [];
    let baseDistance = 0;

    // ★ 이동 수단별 경로 분기 처리
    if (transportType === 'walk') {
      // 1. 도보 선택 시: 두 장소 간 직선 거리 계산 (미터 단위)
      const lat1 = Number(origin.y);
      const lon1 = Number(origin.x);
      const lat2 = Number(destination.y);
      const lon2 = Number(destination.x);

      const R = 6371e3; // 지구 반지름 (m)
      const φ1 = lat1 * Math.PI / 180;
      const φ2 = lat2 * Math.PI / 180;
      const Δφ = (lat2 - lat1) * Math.PI / 180;
      const Δλ = (lon2 - lon1) * Math.PI / 180;

      const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
                Math.cos(φ1) * Math.cos(φ2) *
                Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

      // 도보 이동 거리는 도보 도로 곡률 반영하여 직선거리의 약 1.25배로 설정
      baseDistance = Math.round(R * c * 1.25);

      // 도보 경로 좌표 (직선 연결)
      pathCoordinates = [
        { lng: lon1, lat: lat1 },
        { lng: lon2, lat: lat2 }
      ];
    } else {
      // 2. 대중교통 / 버스 / 지하철 선택 시: 카카오 길찾기 API 호출
      const kakaoUrl = `https://apis-navi.kakaomobility.com/v1/directions?origin=${origin.x},${origin.y}&destination=${destination.x},${destination.y}`;
      
      const kakaoRes = await axios.get(kakaoUrl, {
        headers: { Authorization: `KakaoAK ${process.env.KAKAO_REST_API_KEY}` }
      });

      const routeData = kakaoRes.data.routes[0];
      if (!routeData || routeData.result_code !== 0) {
        return res.status(400).json({ error: '경로를 찾을 수 없습니다.' });
      }

      baseDistance = routeData.summary.distance;

      // 경로 좌표 추출
      routeData.sections.forEach(section => {
        section.roads.forEach(road => {
          for (let i = 0; i < road.vertexes.length; i += 2) {
            pathCoordinates.push({
              lng: road.vertexes[i],
              lat: road.vertexes[i + 1]
            });
          }
        });
      });
    }

    // 선택한 이동 수단에 따른 기준 소요 시간 동적 산출
    const baseDuration = calculateBaseDuration(baseDistance, transportType);

    const transportLabel = 
      transportType === 'walk' ? '도보' : 
      transportType === 'bus' ? '버스' : 
      transportType === 'subway' ? '지하철' : '대중교통 전체';

    // 옵션별 소요 시간 및 차별화 설정
    const routes = [
      {
        id: 'A',
        name: `빠른 길 (${transportLabel})`,
        time: baseDuration,
        distance: baseDistance,
        hasStairs: true,
        hasSlope: true,
        path: pathCoordinates
      },
      {
        id: 'B',
        name: `편한 길 (${transportLabel})`,
        time: transportType === 'walk' ? Math.round(baseDuration * 1.2) + 2 : baseDuration + 6,
        distance: baseDistance + 180,
        hasStairs: false,
        hasSlope: false,
        path: pathCoordinates
      },
      {
        id: 'C',
        name: `균형형 (${transportLabel})`,
        time: transportType === 'walk' ? Math.round(baseDuration * 1.1) : baseDuration + 3,
        distance: baseDistance + 80,
        hasStairs: false,
        hasSlope: true,
        path: pathCoordinates
      }
    ];

    const evaluatedRoutes = routes.map(route => ({
      ...route,
      difficulty: calculateDifficulty(route, profile, transportType)
    }));

    // 난이도가 가장 낮은 순으로 정렬 후 최상위 항목 추천
    evaluatedRoutes.sort((a, b) => a.difficulty - b.difficulty);
    evaluatedRoutes[0].isRecommended = true;

    res.json({
      routes: evaluatedRoutes,
      recommendationReason: `${transportLabel} 이동 기준, 총 거리 ${(baseDistance / 1000).toFixed(1)}km 경로에 맞춰 최적화된 소요 시간입니다.`
    });

  } catch (error) {
    console.error(error.message);
    res.status(500).json({ error: '경로 계산 중 오류가 발생했습니다.' });
  }
});

// Render 배포 환경 포트 처리
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
