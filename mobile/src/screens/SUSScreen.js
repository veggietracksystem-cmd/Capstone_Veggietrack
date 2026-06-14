import { useState, useEffect } from 'react';
import {
  Text, View, ScrollView, TouchableOpacity, StyleSheet,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { showAlert } from '../lib/ui';

const PRIMARY = '#2e7d32';
const HISTORY_KEY = 'sus_scores';

// Standard 10-item System Usability Scale. Odd-numbered items (1,3,5,7,9 ->
// 0-based even indexes) are positive; even-numbered are negative.
const QUESTIONS = [
  'I think that I would like to use this app frequently.',
  'I found the app unnecessarily complex.',
  'I thought the app was easy to use.',
  'I think that I would need the support of a technical person to be able to use this app.',
  'I found the various functions in this app were well integrated.',
  'I thought there was too much inconsistency in this app.',
  'I would imagine that most people would learn to use this app very quickly.',
  'I found the app very cumbersome to use.',
  'I felt very confident using the app.',
  'I needed to learn a lot of things before I could get going with this app.',
];

const LIKERT = [
  { value: 1, label: 'Strongly Disagree' },
  { value: 2, label: 'Disagree' },
  { value: 3, label: 'Neutral' },
  { value: 4, label: 'Agree' },
  { value: 5, label: 'Strongly Agree' },
];

function interpret(score) {
  if (score >= 80.3) return 'Excellent';
  if (score >= 68) return 'Good';
  if (score >= 51) return 'Poor';
  return 'Awful';
}

// SUS formula: odd-indexed (0-based: 0,2,4,6,8) -> answer - 1;
// even-indexed (1,3,5,7,9) -> 5 - answer; sum * 2.5 -> 0..100.
function computeScore(answers) {
  let sum = 0;
  for (let i = 0; i < answers.length; i += 1) {
    sum += i % 2 === 0 ? answers[i] - 1 : 5 - answers[i];
  }
  return sum * 2.5;
}

export default function SUSScreen({ navigation }) {
  const [answers, setAnswers] = useState(Array(QUESTIONS.length).fill(0));
  const [result, setResult] = useState(null); // number | null
  const [history, setHistory] = useState([]);
  const [showHistory, setShowHistory] = useState(false);

  useEffect(() => {
    loadHistory();
  }, []);

  const loadHistory = async () => {
    try {
      const raw = await AsyncStorage.getItem(HISTORY_KEY);
      setHistory(raw ? JSON.parse(raw) : []);
    } catch (err) {
      console.warn('[SUS] Failed to load history:', err);
    }
  };

  const setAnswer = (questionIndex, value) => {
    setAnswers((prev) => {
      const next = [...prev];
      next[questionIndex] = value;
      return next;
    });
  };

  const allAnswered = answers.every((a) => a > 0);

  const submit = async () => {
    if (!allAnswered) {
      showAlert('Incomplete', 'Please answer all 10 questions before submitting.');
      return;
    }
    const score = computeScore(answers);
    setResult(score);

    const entry = { score, interpretation: interpret(score), timestamp: new Date().toISOString() };
    try {
      const raw = await AsyncStorage.getItem(HISTORY_KEY);
      const list = raw ? JSON.parse(raw) : [];
      const updated = [entry, ...list];
      await AsyncStorage.setItem(HISTORY_KEY, JSON.stringify(updated));
      setHistory(updated);
    } catch (err) {
      console.warn('[SUS] Failed to save score:', err);
    }
  };

  const retake = () => {
    setAnswers(Array(QUESTIONS.length).fill(0));
    setResult(null);
    setShowHistory(false);
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        {navigation ? (
          <TouchableOpacity onPress={() => navigation.goBack()}>
            <Text style={styles.back}>‹ Back</Text>
          </TouchableOpacity>
        ) : <View style={{ width: 50 }} />}
        <Text style={styles.title}>Usability Survey</Text>
        <View style={{ width: 50 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {result !== null ? (
          // ---- Result view ----
          <View style={styles.resultCard}>
            <Text style={styles.resultLabel}>Your SUS Score</Text>
            <Text style={styles.resultScore}>{result.toFixed(1)}</Text>
            <Text style={styles.resultInterp}>{interpret(result)}</Text>
            <TouchableOpacity style={[styles.button, styles.buttonPrimary]} onPress={retake}>
              <Text style={styles.buttonPrimaryText}>Retake Survey</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.button, styles.buttonOutline]}
              onPress={() => setShowHistory((s) => !s)}
            >
              <Text style={styles.buttonOutlineText}>
                {showHistory ? 'Hide Previous Scores' : 'View Previous Scores'}
              </Text>
            </TouchableOpacity>
          </View>
        ) : (
          // ---- Questionnaire view ----
          <>
            <Text style={styles.intro}>
              Rate each statement from 1 (Strongly Disagree) to 5 (Strongly Agree).
            </Text>
            {QUESTIONS.map((q, i) => (
              <View key={i} style={styles.questionCard}>
                <Text style={styles.questionText}>{i + 1}. {q}</Text>
                <View style={styles.likertRow}>
                  {LIKERT.map((opt) => {
                    const selected = answers[i] === opt.value;
                    return (
                      <TouchableOpacity
                        key={opt.value}
                        style={[styles.likertChip, selected && styles.likertChipActive]}
                        onPress={() => setAnswer(i, opt.value)}
                      >
                        <Text style={[styles.likertChipText, selected && styles.likertChipTextActive]}>
                          {opt.value}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>
            ))}

            <TouchableOpacity
              style={[styles.button, styles.buttonPrimary, !allAnswered && styles.buttonDisabled]}
              onPress={submit}
              disabled={!allAnswered}
            >
              <Text style={styles.buttonPrimaryText}>Submit</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.button, styles.buttonOutline]}
              onPress={() => setShowHistory((s) => !s)}
            >
              <Text style={styles.buttonOutlineText}>
                {showHistory ? 'Hide Previous Scores' : 'View Previous Scores'}
              </Text>
            </TouchableOpacity>
          </>
        )}

        {showHistory && (
          <View style={styles.historyBox}>
            <Text style={styles.sectionTitle}>Previous Scores</Text>
            {history.length === 0 ? (
              <Text style={styles.emptyText}>No previous scores yet.</Text>
            ) : (
              history.map((h, i) => (
                <View key={i} style={styles.historyRow}>
                  <Text style={styles.historyScore}>{Number(h.score).toFixed(1)} · {h.interpretation}</Text>
                  <Text style={styles.historyDate}>{new Date(h.timestamp).toLocaleString()}</Text>
                </View>
              ))
            )}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16 },
  back: { color: PRIMARY, fontSize: 16, fontWeight: '600', width: 50 },
  title: { fontSize: 20, fontWeight: 'bold', color: PRIMARY },
  content: { padding: 16, paddingBottom: 40 },
  intro: { fontSize: 14, color: '#555', marginBottom: 16 },

  questionCard: { backgroundColor: '#fff', borderRadius: 10, padding: 14, marginBottom: 12, borderWidth: 1, borderColor: '#eee' },
  questionText: { fontSize: 15, color: '#222', marginBottom: 12 },
  likertRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 6 },
  likertChip: { flex: 1, paddingVertical: 10, borderRadius: 8, borderWidth: 1, borderColor: '#ccc', backgroundColor: '#fafafa', alignItems: 'center' },
  likertChipActive: { backgroundColor: PRIMARY, borderColor: PRIMARY },
  likertChipText: { color: '#555', fontWeight: '600' },
  likertChipTextActive: { color: '#fff' },

  button: { paddingVertical: 14, borderRadius: 8, alignItems: 'center', marginTop: 12 },
  buttonPrimary: { backgroundColor: PRIMARY },
  buttonPrimaryText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  buttonOutline: { borderWidth: 1, borderColor: PRIMARY },
  buttonOutlineText: { color: PRIMARY, fontSize: 16, fontWeight: '600' },
  buttonDisabled: { opacity: 0.6 },

  resultCard: { backgroundColor: '#fff', borderRadius: 12, padding: 24, alignItems: 'center', borderWidth: 1, borderColor: '#eee' },
  resultLabel: { fontSize: 16, color: '#555' },
  resultScore: { fontSize: 56, fontWeight: 'bold', color: PRIMARY, marginVertical: 8 },
  resultInterp: { fontSize: 20, fontWeight: '600', color: '#333', marginBottom: 12 },

  historyBox: { marginTop: 20 },
  sectionTitle: { fontSize: 18, fontWeight: '700', color: '#333', marginBottom: 10 },
  emptyText: { color: '#888', fontStyle: 'italic' },
  historyRow: { backgroundColor: '#fff', borderRadius: 8, padding: 12, marginBottom: 8, borderWidth: 1, borderColor: '#eee' },
  historyScore: { fontSize: 16, fontWeight: '700', color: PRIMARY },
  historyDate: { fontSize: 13, color: '#888', marginTop: 2 },
});
