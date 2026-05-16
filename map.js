import mapboxgl from 'https://cdn.jsdelivr.net/npm/mapbox-gl@2.15.0/+esm';
import * as d3 from 'https://cdn.jsdelivr.net/npm/d3@7/+esm';

mapboxgl.accessToken = 'pk.eyJ1Ijoicmlja2ljaGVuIiwiYSI6ImNtcDNoYnI5dTBibXYyc29vdjdyb2RneW8ifQ.AXfRVsbLWjOojmlQQY4H3Q';

const map = new mapboxgl.Map({
  container: 'map',
  style: 'mapbox://styles/mapbox/streets-v12',
  center: [-71.09415, 42.36027],
  zoom: 12,
  minZoom: 5,
  maxZoom: 18,
});

let departuresByMinute = Array.from({ length: 1440 }, () => []);
let arrivalsByMinute = Array.from({ length: 1440 }, () => []);
let timeFilter = -1;

function formatTime(minutes) {
  const date = new Date(0, 0, 0, 0, minutes);
  return date.toLocaleString('en-US', { timeStyle: 'short' });
}

function minutesSinceMidnight(date) {
  return date.getHours() * 60 + date.getMinutes();
}

function getCoords(station) {
  const point = new mapboxgl.LngLat(+station.lon, +station.lat);
  const { x, y } = map.project(point);
  return { cx: x, cy: y };
}

function filterByMinute(tripsByMinute, minute) {
  if (minute === -1) {
    return tripsByMinute.flat();
  }

  const minMinute = (minute - 60 + 1440) % 1440;
  const maxMinute = (minute + 60) % 1440;

  if (minMinute > maxMinute) {
    const before = tripsByMinute.slice(minMinute);
    const after = tripsByMinute.slice(0, maxMinute + 1);
    return before.concat(after).flat();
  }

  return tripsByMinute.slice(minMinute, maxMinute + 1).flat();
}

function computeStationTraffic(stations, tFilter = -1) {
  const departures = d3.rollup(
    filterByMinute(departuresByMinute, tFilter),
    (v) => v.length,
    (d) => d.start_station_id
  );

  const arrivals = d3.rollup(
    filterByMinute(arrivalsByMinute, tFilter),
    (v) => v.length,
    (d) => d.end_station_id
  );

  return stations.map((station) => {
    const id = station.short_name;

    return {
      ...station,
      arrivals: arrivals.get(id) ?? 0,
      departures: departures.get(id) ?? 0,
      totalTraffic: (arrivals.get(id) ?? 0) + (departures.get(id) ?? 0),
    };
  });
}

map.on('load', async () => {
  map.addSource('boston_route', {
    type: 'geojson',
    data: 'https://bostonopendata-boston.opendata.arcgis.com/datasets/boston::existing-bike-network-2022.geojson',
  });

  map.addLayer({
    id: 'bike-lanes-boston',
    type: 'line',
    source: 'boston_route',
    paint: {
      'line-color': '#32D400',
      'line-width': 3,
      'line-opacity': 0.5,
    },
  });

  map.addSource('cambridge_route', {
    type: 'geojson',
    data: 'https://raw.githubusercontent.com/cambridgegis/cambridgegis_data/main/Recreation/Bike_Facilities/RECREATION_BikeFacilities.geojson',
  });

  map.addLayer({
    id: 'bike-lanes-cambridge',
    type: 'line',
    source: 'cambridge_route',
    paint: {
      'line-color': '#32D400',
      'line-width': 3,
      'line-opacity': 0.5,
    },
  });

  const jsonData = await d3.json(
    'https://dsc106.com/labs/lab07/data/bluebikes-stations.json'
  );

  let stations = jsonData.data.stations;

  await d3.csv(
    'https://dsc106.com/labs/lab07/data/bluebikes-traffic-2024-03.csv',
    (trip) => {
      trip.started_at = new Date(trip.started_at);
      trip.ended_at = new Date(trip.ended_at);

      const startedMin = minutesSinceMidnight(trip.started_at);
      const endedMin = minutesSinceMidnight(trip.ended_at);

      departuresByMinute[startedMin].push(trip);
      arrivalsByMinute[endedMin].push(trip);

      return trip;
    }
  );

  stations = computeStationTraffic(stations);

  const svg = d3.select('#map').select('svg');

  const radiusScale = d3
    .scaleSqrt()
    .domain([0, d3.max(stations, (d) => d.totalTraffic) || 1])
    .range([2, 18]);

  const stationFlow = d3.scaleQuantize().domain([0, 1]).range([0, 0.5, 1]);

  let circles = svg
    .selectAll('circle')
    .data(stations, (d) => d.short_name)
    .join('circle')
    .attr('r', (d) => radiusScale(d.totalTraffic))
    .style('--departure-ratio', (d) =>
      d.totalTraffic > 0 ? stationFlow(d.departures / d.totalTraffic) : 0.5
    )
    .each(function (d) {
      d3.select(this)
        .append('title')
        .text(
          `${d.totalTraffic} trips (${d.departures} departures, ${d.arrivals} arrivals)`
        );
    });

  function updatePositions() {
    circles
      .attr('cx', (d) => getCoords(d).cx)
      .attr('cy', (d) => getCoords(d).cy);
  }

  function updateScatterPlot(tFilter) {
    const filteredStations = computeStationTraffic(stations, tFilter);

    const maxTraffic = d3.max(filteredStations, (d) => d.totalTraffic) || 1;

    radiusScale.domain([0, maxTraffic]).range([2, 18]);

    circles = svg
      .selectAll('circle')
      .data(filteredStations, (d) => d.short_name)
      .join('circle')
      .attr('r', (d) => radiusScale(d.totalTraffic))
      .style('--departure-ratio', (d) =>
        d.totalTraffic > 0 ? stationFlow(d.departures / d.totalTraffic) : 0.5
      )
      .each(function (d) {
        let title = d3.select(this).select('title');

        if (title.empty()) {
          title = d3.select(this).append('title');
        }

        title.text(
          `${d.totalTraffic} trips (${d.departures} departures, ${d.arrivals} arrivals)`
        );
      });

    updatePositions();
  }

  updatePositions();

  map.on('move', updatePositions);
  map.on('resize', updatePositions);

  const timeSlider = document.getElementById('time-slider');
  const selectedTime = document.getElementById('selected-time');
  const anyTimeLabel = document.getElementById('any-time');

  function updateTimeDisplay() {
    timeFilter = Number(timeSlider.value);

    if (timeFilter === -1) {
      selectedTime.style.visibility = 'hidden';
      anyTimeLabel.style.visibility = 'visible';
    } else {
      selectedTime.textContent = formatTime(timeFilter);
      selectedTime.style.visibility = 'visible';
      anyTimeLabel.style.visibility = 'hidden';
    }

    updateScatterPlot(timeFilter);
  }

  let frameId;

  timeSlider.addEventListener('input', () => {
    if (frameId) {
      cancelAnimationFrame(frameId);
    }

    frameId = requestAnimationFrame(updateTimeDisplay);
  });

  updateTimeDisplay();
});

