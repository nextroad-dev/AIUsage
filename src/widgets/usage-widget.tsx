import { Gauge, HStack, Spacer, Text, VStack } from '@expo/ui/swift-ui';
import {
  font,
  foregroundStyle,
  frame,
  gaugeStyle,
  lineLimit,
  monospacedDigit,
  padding,
  tint,
  widgetURL,
} from '@expo/ui/swift-ui/modifiers';
import { createWidget, type WidgetEnvironment } from 'expo-widgets';

export interface WidgetMeter {
  /** translated window name, e.g. "5-hour window" */
  label: string;
  /** short form for tight layouts, e.g. "5h" / "Week" */
  short: string;
  /** used fraction 0..1, or -1 when the meter has no ratio */
  used: number;
  /** epoch ms of the next reset */
  resetsAt?: number;
}

export interface WidgetAccount {
  name: string;
  meters: WidgetMeter[];
}

export interface UsageWidgetProps {
  accounts: WidgetAccount[];
  /** translated copy; the widget runtime cannot reach the app's dictionary */
  emptyText: string;
  resetsLabel: string;
}

/**
 * Home and Lock Screen widget. Runs in WidgetKit's isolated runtime: everything it needs arrives
 * through props, and helpers must live inside the function (no module-scope references).
 * Small: the most constrained account as gauges. Medium: up to three accounts. Lock Screen:
 * the tightest window as a circular gauge, or a line of text.
 */
const UsageWidget = (props: UsageWidgetProps, environment: WidgetEnvironment) => {
  'widget';
  const colorFor = (used: number) =>
    used < 0 ? '#8A8F98' : used >= 0.85 ? '#E5484D' : used >= 0.6 ? '#F5A524' : '#30A46C';
  const pct = (used: number) => (used < 0 ? '—' : `${Math.round(used * 100)}%`);
  const accounts = props.accounts ?? [];
  const top = accounts[0];
  const tightest = top?.meters[0];
  const family = environment.widgetFamily;

  const MeterGauge = ({ meter, size }: { meter: WidgetMeter; size: number }) => (
    <VStack spacing={2}>
      <Gauge
        value={meter.used < 0 ? 0 : Math.min(1, meter.used)}
        currentValueLabel={<Text modifiers={[monospacedDigit()]}>{pct(meter.used)}</Text>}
        modifiers={[
          gaugeStyle('circularCapacity'),
          tint(colorFor(meter.used)),
          frame({ width: size, height: size }),
        ]}
      />
      <Text modifiers={[font({ size: 11, weight: 'medium' }), lineLimit(1)]}>{meter.short}</Text>
    </VStack>
  );

  if (!top) {
    return (
      <VStack modifiers={[widgetURL('usage://')]}>
        <Text
          modifiers={[
            font({ size: 13 }),
            foregroundStyle({ type: 'hierarchical', style: 'secondary' }),
          ]}
        >
          {props.emptyText}
        </Text>
      </VStack>
    );
  }

  if (family === 'accessoryInline') {
    return <Text>{`${top.name} ${tightest ? pct(tightest.used) : ''}`}</Text>;
  }

  if (family === 'accessoryCircular') {
    return (
      <Gauge
        value={tightest && tightest.used >= 0 ? Math.min(1, tightest.used) : 0}
        currentValueLabel={<Text>{tightest ? pct(tightest.used) : '—'}</Text>}
        modifiers={[gaugeStyle('circularCapacity'), widgetURL('usage://')]}
      >
        <Text>{tightest?.short ?? ''}</Text>
      </Gauge>
    );
  }

  if (family === 'accessoryRectangular') {
    return (
      <VStack alignment="leading" spacing={2} modifiers={[widgetURL('usage://')]}>
        <Text modifiers={[font({ size: 13, weight: 'semibold' }), lineLimit(1)]}>{top.name}</Text>
        {top.meters.slice(0, 2).map((m) => (
          <Text key={m.label} modifiers={[font({ size: 12 }), monospacedDigit(), lineLimit(1)]}>
            {`${m.short} ${pct(m.used)}`}
          </Text>
        ))}
      </VStack>
    );
  }

  const AccountBlock = ({ account, size }: { account: WidgetAccount; size: number }) => {
    const soonest = account.meters
      .map((m) => m.resetsAt)
      .filter((x): x is number => typeof x === 'number')
      .sort((a, b) => a - b)[0];
    return (
      <VStack alignment="leading" spacing={6}>
        <Text modifiers={[font({ size: 13, weight: 'semibold' }), lineLimit(1)]}>
          {account.name}
        </Text>
        <HStack spacing={8}>
          {account.meters.slice(0, 2).map((m) => (
            <MeterGauge key={m.label} meter={m} size={size} />
          ))}
        </HStack>
        {soonest ? (
          <HStack spacing={3}>
            <Text
              modifiers={[
                font({ size: 10 }),
                foregroundStyle({ type: 'hierarchical', style: 'secondary' }),
              ]}
            >
              {props.resetsLabel}
            </Text>
            <Text
              date={new Date(soonest)}
              dateStyle="relative"
              modifiers={[
                font({ size: 10 }),
                monospacedDigit(),
                foregroundStyle({ type: 'hierarchical', style: 'secondary' }),
                lineLimit(1),
              ]}
            />
          </HStack>
        ) : null}
      </VStack>
    );
  };

  if (family === 'systemSmall') {
    return (
      <VStack alignment="leading" modifiers={[widgetURL('usage://')]}>
        <AccountBlock account={top} size={52} />
        <Spacer />
      </VStack>
    );
  }

  return (
    <HStack alignment="top" spacing={14} modifiers={[padding({ all: 2 }), widgetURL('usage://')]}>
      {accounts.slice(0, 3).map((a) => (
        <AccountBlock key={a.name} account={a} size={44} />
      ))}
      <Spacer />
    </HStack>
  );
};

export default createWidget('UsageWidget', UsageWidget);
