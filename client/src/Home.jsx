import { Container, Title } from '@mantine/core';
import { Head } from '@unhead/react';
import { MapContainer } from 'react-leaflet/MapContainer'
import { TileLayer } from 'react-leaflet/TileLayer'
import { Popup } from 'react-leaflet/Popup'
import { Marker } from 'react-leaflet/Marker'
import { useMap } from 'react-leaflet/hooks'
import LeafletContainer from './Components/LeafletContainer'
import 'leaflet/dist/leaflet.css'

function Home () {
  return (
    <>
      <Head>
        <title>Home</title>
      </Head>
      <Container>
        <Title>Pocket Gardens</Title>
        <LeafletContainer></LeafletContainer>
      </Container>
    </>
  );
}

export default Home;
