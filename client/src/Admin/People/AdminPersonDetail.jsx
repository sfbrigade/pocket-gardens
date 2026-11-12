import { Link, useParams, useSearchParams } from 'react-router';
import { Anchor, Button, Container, Group, Loader, Table, Text, Title } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { Head } from '@unhead/react';

import Api from 'src/Api';

function AdminPersonDetail () {
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  const historyPage = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10) || 1);
  const historyPageSize = 25;
  const historyOffset = (historyPage - 1) * historyPageSize;

  const { data: person, isLoading, isError } = useQuery({
    queryKey: ['people', id],
    queryFn: async () => {
      const response = await Api.people.get(id);
      return response.data;
    },
  });

  const {
    data: maintenanceRecords,
    isLoading: isHistoryLoading,
    isError: isHistoryError,
  } = useQuery({
    queryKey: ['maintenanceRecords', id, historyPage],
    queryFn: async () => {
      const response = await Api.maintenanceRecords.index(id, historyOffset, historyPageSize);
      return {
        records: response.data,
        hasMore: response.headers['x-next-offset'] != null,
      };
    },
  });

  if (isLoading) {
    return (
      <Container>
        <Loader />
      </Container>
    );
  }

  if (isError) {
    return (
      <Container>
        <Text>Unable to load person.</Text>
        <Anchor component={Link} to='/admin/people'>Back to People</Anchor>
      </Container>
    );
  }

  return (
    <>
      <Head>
        <title>Person Detail</title>
      </Head>
      <Container>
        <Anchor component={Link} to='/admin/people'>Back to People</Anchor>
        <Title mb='md'>{person.name || [person.firstName, person.lastName].filter(Boolean).join(' ') || 'Unnamed Person'}</Title>
        <Text>Email: {person.email || 'Not provided'}</Text>
        <Text>Phone: {person.phone || 'Not provided'}</Text>
        <Text>Home ZIP Code: {person.homeZipCode || 'Not provided'}</Text>

        <Title order={2} mt='lg' mb='sm'>Assigned Plots</Title>

        <Table.ScrollContainer>
          <Table striped highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Name</Table.Th>
                <Table.Th>Address</Table.Th>
                <Table.Th>Status</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {person.assignedPlots.length === 0 &&
                <Table.Tr>
                  <Table.Td colSpan={3}>
                    No assigned plots.
                  </Table.Td>
                </Table.Tr>}
              {person.assignedPlots.map((plot) => (
                <Table.Tr key={plot.id}>
                  <Table.Td>{plot.name || 'Unnamed Plot'}</Table.Td>
                  <Table.Td>{plot.streetAddress || 'Not provided'}</Table.Td>
                  <Table.Td>{plot.status || 'Not provided'}</Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>

        <Title order={2} mt='lg' mb='sm'>Participation History</Title>

        {isHistoryLoading && <Loader />}

        {isHistoryError && (
          <Text>Unable to load participation history.</Text>
        )}

        {maintenanceRecords && (
          <>
            <Table.ScrollContainer>
              <Table striped highlightOnHover>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Date</Table.Th>
                    <Table.Th>Plot</Table.Th>
                    <Table.Th>Activity</Table.Th>
                    <Table.Th>Notes</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {maintenanceRecords.records.length === 0 && (
                    <Table.Tr>
                      <Table.Td colSpan={4}>
                        No participation history.
                      </Table.Td>
                    </Table.Tr>
                  )}
                  {maintenanceRecords.records.map((record) => (
                    <Table.Tr key={record.id}>
                      <Table.Td>{record.date || 'Not provided'}</Table.Td>
                      <Table.Td>{record.plotName || 'Not provided'}</Table.Td>
                      <Table.Td>{record.activity.length ? record.activity.join(', ') : 'Not provided'}</Table.Td>
                      <Table.Td>{record.notes || 'Not provided'}</Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Table.ScrollContainer>

            {(historyPage > 1 || maintenanceRecords.hasMore) && (
              <Group mt='md'>
                <Button
                  component={Link}
                  to={`?page=${historyPage - 1}`}
                  disabled={historyPage === 1}
                  variant='default'
                >
                  Previous
                </Button>

                <Text>Page {historyPage}</Text>

                <Button
                  component={Link}
                  to={`?page=${historyPage + 1}`}
                  disabled={!maintenanceRecords.hasMore}
                  variant='default'
                >
                  Next
                </Button>
              </Group>
            )}
          </>
        )}
      </Container>
    </>
  );
}

export default AdminPersonDetail;
