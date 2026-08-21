require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.use(cors());
app.use(express.json());

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

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

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

    // 카카오 길찾기 API 호출 (경로 뼈대 데이터 수집)
    const kakaoUrl = `https://apis-navi.kakaomobility.com/v1/directions?origin=${origin.x},${origin.y}&destination=${destination.x},${destination.y}`;
    
    const kakaoRes = await axios.get(kakaoUrl, {
      headers: { Authorization: `KakaoAK ${process.env.KAKAO_REST_API_KEY}` }
    });

    const routeData = kakaoRes.data.routes[0];
    if (!routeData || routeData.result_code !== 0) {
      return res.status(400).json({ error: '경로를 찾을 수 없습니다.' });
    }

    // 경로 좌표 추출
    const pathCoordinates = [];
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

    const baseDistance = routeData.summary.distance; // 미터(m) 단위
    
    // ★ 선택한 이동 수단에 따른 기준 소요 시간 동적 산출
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
        // 계단/경사를 피하는 우회 경로 시 소요 시간 증대
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

app.listen(3000, () => console.log('Server running on http://localhost:3000'));
