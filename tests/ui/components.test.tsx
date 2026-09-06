// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { StatusPill, SeverityPill } from '@/design/primitives/StatusPill';
import { TrendIndicator } from '@/design/primitives/Trend';
import { ConfidenceDisplay, ScoreDisplay } from '@/design/primitives/Score';
import { ScoreBar } from '@/design/charts/ScoreBar';
import { Sparkline } from '@/design/charts/Sparkline';
import { EmptyState, ErrorState } from '@/design/primitives/States';
import { ProvisionalBadge } from '@/design/primitives/Meta';
import { DataModeBanner } from '@/design/primitives/DataModeBanner';

afterEach(cleanup);

describe('status is never communicated by colour alone', () => {
  it('writes the status in words alongside a shape', () => {
    render(<StatusPill status="NEEDS_ATTENTION" />);
    expect(screen.getByText('Needs attention')).toBeTruthy();
  });

  it('labels a missing score rather than showing an empty cell', () => {
    render(<StatusPill status="NO_DATA" />);
    expect(screen.getByText('No data')).toBeTruthy();
  });

  it('writes severity in words', () => {
    render(<SeverityPill severity="HIGH" />);
    expect(screen.getByText('High')).toBeTruthy();
  });
});

describe('trend', () => {
  it('states the direction for assistive technology, not only an arrow', () => {
    const { container } = render(
      <TrendIndicator trend={{ direction: 'DECLINING', changePct: -8.4, changePoints: -4, periods: 4 }} />,
    );
    expect(container.textContent).toContain('-8.4%');
    expect(screen.getByText(/Declining over 4 periods/)).toBeTruthy();
  });

  it('says there is not enough history instead of implying stability', () => {
    render(<TrendIndicator trend={{ direction: 'UNKNOWN', changePct: null, changePoints: null, periods: 1 }} />);
    expect(screen.getByText('Not enough history')).toBeTruthy();
  });
});

describe('score and confidence are visibly different measures', () => {
  it('renders a score out of 100', () => {
    const { container } = render(<ScoreDisplay score={73.7} />);
    expect(container.textContent).toContain('73.7');
    expect(container.textContent).toContain('/ 100');
  });

  it('renders a missing score as a dash with an accessible explanation', () => {
    render(<ScoreDisplay score={null} />);
    expect(screen.getByText('Score not available')).toBeTruthy();
  });

  it('renders confidence as a percentage with a named band', () => {
    const { container } = render(<ConfidenceDisplay score={33.3} band="LOW" />);
    expect(container.textContent).toContain('33.3%');
    expect(screen.getByText('Low confidence')).toBeTruthy();
  });

  it('keeps the band available to screen readers when it is visually hidden', () => {
    render(<ConfidenceDisplay score={91} band="HIGH" hideLabel />);
    expect(screen.getByText('High confidence')).toBeTruthy();
  });
});

describe('charts carry accessible descriptions', () => {
  it('describes a score bar including the threshold it is judged against', () => {
    render(<ScoreBar score={62} target={75} status="WATCH" />);
    expect(screen.getByLabelText('Score 62 out of 100 against a threshold of 75')).toBeTruthy();
  });

  it('describes an absent score rather than drawing an empty bar silently', () => {
    render(<ScoreBar score={null} target={75} status="NO_DATA" />);
    expect(screen.getByLabelText('No score available')).toBeTruthy();
  });

  it('breaks a sparkline at missing periods instead of interpolating across them', () => {
    const { container } = render(
      <Sparkline values={[10, 20, null, 40, 50]} label="Test series" />,
    );
    // Two separate paths: one either side of the gap.
    expect(container.querySelectorAll('path')).toHaveLength(2);
  });

  it('degrades to a dash when there is not enough history to draw a shape', () => {
    const { container } = render(<Sparkline values={[10]} label="Test series" />);
    expect(container.querySelector('svg')).toBeNull();
    expect(container.textContent).toContain('—');
  });
});

describe('states explain rather than sitting blank', () => {
  it('gives an empty state a reason', () => {
    render(<EmptyState title="No SRHR data for this period." description="Last synchronised 2 hours ago." />);
    expect(screen.getByText('No SRHR data for this period.')).toBeTruthy();
    expect(screen.getByText('Last synchronised 2 hours ago.')).toBeTruthy();
  });

  it('writes errors for people and hides technical detail behind a disclosure', () => {
    render(<ErrorState technical="TypeError: Cannot read properties of undefined" />);
    expect(screen.getByText(/We couldn\u2019t load this right now/)).toBeTruthy();
    expect(screen.getByText('Technical detail')).toBeTruthy();
  });
});

describe('provenance is always stated', () => {
  it('badges a provisional methodology', () => {
    render(<ProvisionalBadge version="ASPIRE-SRHR-PROVISIONAL-v0" status="PROVISIONAL" />);
    expect(screen.getByText('Provisional methodology')).toBeTruthy();
  });

  it('names an official methodology by version instead of warning about it', () => {
    render(<ProvisionalBadge version="ASPIRE-SRHR-v1" status="OFFICIAL" />);
    expect(screen.getByText('ASPIRE-SRHR-v1')).toBeTruthy();
  });

  it('says demo figures are not government reporting', () => {
    const { container } = render(
      <DataModeBanner mode="DEMO" label="Demo dataset" lastSyncAt="2026-09-06T00:00:00.000Z" />,
    );
    expect(screen.getByText('Demo data')).toBeTruthy();
    expect(container.textContent).toContain('not government reporting');
  });

  it('names the live source when connected to DHIS2', () => {
    const { container } = render(
      <DataModeBanner mode="DHIS2" label="https://dhis2.example.org" lastSyncAt="2026-09-06T00:00:00.000Z" />,
    );
    expect(screen.getByText('Live DHIS2')).toBeTruthy();
    expect(container.textContent).toContain('dhis2.example.org');
  });
});
