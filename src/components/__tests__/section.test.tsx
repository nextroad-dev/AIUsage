import { render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';

import { Band, Section } from '@/components/section';

describe('Section', () => {
  it('groups content in a band', async () => {
    await render(
      <Section title="Accounts">
        <Text>row</Text>
      </Section>,
    );
    expect(screen.getByText('Accounts')).toBeTruthy();
    expect(screen.getByText('row')).toBeTruthy();
  });

  it('renders a bare band without a title', async () => {
    await render(
      <Band>
        <Text>only</Text>
      </Band>,
    );
    expect(screen.getByText('only')).toBeTruthy();
  });
});
