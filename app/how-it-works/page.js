import { TOPICS } from '../../lib/topics/taxonomy.js';
import { LOW_SAMPLE } from '../../lib/analytics.js';

export const metadata = { title: 'How it works · Guest Review Pulse' };

export default function HowItWorks() {
  return (
    <div className="prose" style={{ marginTop: 28 }}>
      <h1 style={{ fontSize: '1.6rem' }}>How the numbers work</h1>
      <p>This dashboard reads the public guest reviews on each property&rsquo;s Booking.com page and summarises them. Here is what each number means and where it can mislead.</p>

      <h2>Definitions</h2>
      <dl>
        <dt>Rating</dt>
        <dd>The score the guest gave on Booking.com, from 1 to 10. Averages are simple means of those scores.</dd>
        <dt>Positive, neutral and negative reviews</dt>
        <dd>Positive is 8 to 10 (&ldquo;Very good&rdquo; and above on Booking.com). Negative is 1 to 5 (&ldquo;Passable&rdquo; and below). 6 and 7 are neutral.</dd>
        <dt>This week and last week</dt>
        <dd>Weeks run Monday to Sunday in Sydney time, by the date the review was published, not the date of the stay. &ldquo;This week&rdquo; is the week so far, up to the date shown as &ldquo;Data as of&rdquo;.</dd>
        <dt>Few reviews</dt>
        <dd>When a week has fewer than {LOW_SAMPLE} reviews, it is marked &ldquo;few&rdquo;. With so few reviews, one unhappy guest can move the average by a whole point.</dd>
        <dt>Booking.com score</dt>
        <dd>Booking.com&rsquo;s own all-time headline score for the property, shown for reference. It is calculated by Booking.com and won&rsquo;t match our weekly averages.</dd>
      </dl>

      <h2 id="topics">How topics are tagged</h2>
      <p>Booking.com asks every guest two questions: what they liked and what they didn&rsquo;t like. A topic found in the &ldquo;didn&rsquo;t like&rdquo; answer counts as a <strong>complaint</strong>. A topic found in the &ldquo;liked&rdquo; answer counts as <strong>praise</strong>.</p>
      <p>Topics are found by matching words and phrases (for example &ldquo;dirty&rdquo;, &ldquo;mould&rdquo; and &ldquo;smell&rdquo; for cleanliness), including common words in about 15 other languages. Hover over a topic tag on a review to see which words triggered it.</p>
      <ul>
        {TOPICS.map((t) => <li key={t.id}><strong>{t.label}</strong>{t.critical ? ' (urgent)' : ''}: {t.description}</li>)}
      </ul>
      <p>Pests and Safety are marked urgent: every mention appears under &ldquo;What needs attention&rdquo;, even a single one.</p>

      <h2>Limits to keep in mind</h2>
      <ul>
        <li>About half of all reviews are a rating with no comments. They count towards averages but can&rsquo;t have topics, so topic percentages are based only on reviews with comments.</li>
        <li>Automatic tagging is right most of the time but not always. On a held-out sample of hand-checked reviews, about 3 in 4 complaint tags were correct and nearly 9 in 10 real complaints were found. Praise tags were more accurate. Tags for room, value and location are the least reliable. Read the reviews behind a number before acting on it.</li>
        <li>Answers like &ldquo;Nothing, everything was great&rdquo; in the &ldquo;didn&rsquo;t like&rdquo; box are recognised and not counted as complaints.</li>
        <li>Only public Booking.com reviews are included. Reviews on Google, Expedia and other sites are not.</li>
        <li>Booking.com can change its page at any time. If collection stops working, the Data health page shows it, and the numbers here stop updating rather than becoming wrong.</li>
      </ul>
    </div>
  );
}
