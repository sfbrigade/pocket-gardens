import { Button, Group, NumberInput, Stack, Text } from '@mantine/core';
import PlantPicker from '../Plots/PlantPicker';

export default function MaintenancePlants ({ plants, onChange, disabled }) {
  return (
    <Stack gap='xs'>
      <Text fw={500}>Plants recorded on this visit</Text>
      <Text size='sm'>If you do not know the name, leave this list empty and describe the planting in your note. This records history without changing the garden’s current plant list.</Text>
      <PlantPicker
        disabled={disabled} saveLabel='update' onSelect={(plant) => {
          const duplicate = plants.some((entry) => plant.plantId ? entry.plantId === plant.plantId : JSON.stringify(entry.newPlant) === JSON.stringify(plant.newPlant));
          if (!duplicate) onChange([...plants, plant]);
        }}
      />
      {plants.map((plant, index) => (
        <Group key={`${plant.plantId || 'new'}-${index}`} align='end'>
          <Text>{plant.label || plant.name || 'Plant name not recorded'}</Text>
          <NumberInput label={`Quantity for ${plant.label || plant.name || `plant ${index + 1}`}`} min={1} max={2147483647} allowDecimal={false} disabled={disabled} value={plant.quantity ?? ''} onChange={(quantity) => onChange(plants.map((entry, i) => i === index ? { ...entry, quantity: quantity === '' ? undefined : quantity } : entry))} />
          <Button variant='subtle' color='red' disabled={disabled} onClick={() => onChange(plants.filter((_, i) => i !== index))}>Remove plant {index + 1}</Button>
        </Group>
      ))}
    </Stack>
  );
}
