import { MapContainer } from 'react-leaflet/MapContainer';
import { TileLayer } from 'react-leaflet/TileLayer';
import { Popup } from 'react-leaflet/Popup';
import { Marker } from 'react-leaflet/Marker';
import 'leaflet/dist/leaflet.css';

function LeafletContainer({center, coordinateArray}) {
  
  console.log(coordinateArray)
  // coordinateArray.forEach((element) => console.log(element["Map Coordinates"]))
  const dummy  = coordinateArray.filter(
// this filter is not working for us
        (coordinate) => (coordinate?.lat !== undefined | null) && (coordinate?.long !== undefined | null)
      )
      // .map((coordinate) => {coordinate.lat, coordinate.long})
    
  console.log(dummy)
  return (
    <MapContainer center={center.coord} zoom={13} scrollWheelZoom={false} style={{ height: '100%', width: '100%' }}>
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url='https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png'
      />
      <Marker position={[37.77926, -122.45968]}>
        {/* <Popup>
          A pretty CSS3 popup. <br /> Easily customizable.
        </Popup> */}
      </Marker>
      {coordinateArray.filter(
        // check that coordinate has coordinate.lat and coordinate.long, else do not add the pin?
        (coordinate) => (coordinate?.lat !== undefined | null) && (coordinate?.long !== undefined | null)
      ).map( coordinate =>

    <Marker position={[coordinate.lat, coordinate.long]}></Marker>
  )}
    </MapContainer>
  );
}

export default LeafletContainer;
