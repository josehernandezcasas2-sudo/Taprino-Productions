import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack } from 'expo-router';
import { apiGet } from '../../lib/api';
import { colors } from '../../lib/theme';
import { FileRow, uni } from '../../components/UniversityBits';

// Every downloadable file across every course (pages/university/library.js
// on the web, fed by /api/university/library), filterable by type and
// department. Files open in the in-app browser, where iOS offers share /
// save to Files.
const TYPE_LABEL = { pdf: 'PDF', xlsx: 'Spreadsheet', csv: 'CSV', docx: 'Editable doc', txt: 'Text', fdx: 'Script file', pptx: 'Slides', zip: 'Zip', img: 'Image', lut: 'LUT', audio: 'Audio', project: 'Project file', other: 'Other' };

export default function Library() {
  const [state, setState] = useState({ loading: true, error: null, data: null });
  const [type, setType] = useState(null);
  const [dept, setDept] = useState(null);

  useEffect(() => {
    let cancelled = false;
    apiGet('/api/university/library')
      .then((data) => { if (!cancelled) setState({ loading: false, error: null, data }); })
      .catch((err) => { if (!cancelled) setState({ loading: false, error: err.message, data: null }); });
    return () => { cancelled = true; };
  }, []);

  const data = state.data;
  const files = data ? data.files.filter((f) => (!type || f.fileType === type) && (!dept || f.topicName === dept)) : [];

  return (
    <SafeAreaView style={uni.screen} edges={['bottom']}>
      <Stack.Screen options={{ title: 'Library' }} />
      <ScrollView contentContainerStyle={uni.stage}>
        <Text style={[uni.eyebrow, uni.eyebrowPink]}>Film University</Text>
        <Text style={uni.h1}>Library</Text>
        <Text style={uni.lead}>Templates, worksheets and sample files from every course. Download, fill in, shoot.</Text>
        {state.loading && <ActivityIndicator color={colors.brass} style={{ marginTop: 30 }} />}
        {state.error && <Text style={uni.error}>{state.error}</Text>}
        {data && data.files.length === 0 && <Text style={uni.empty}>No files yet — they arrive with the first courses.</Text>}
        {data && data.files.length > 0 && (
          <>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={uni.chips}>
              <Pressable onPress={() => setType(null)}><Text style={[uni.chip, !type && uni.chipOn]}>All {data.files.length}</Text></Pressable>
              {data.types.map((t) => <Pressable key={t.value} onPress={() => setType(type === t.value ? null : t.value)}><Text style={[uni.chip, type === t.value && uni.chipOn]}>{TYPE_LABEL[t.value] || t.value} {t.count}</Text></Pressable>)}
            </ScrollView>
            {data.departments.length > 1 ? (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={uni.chips}>
                {data.departments.map((d) => <Pressable key={d.id} onPress={() => setDept(dept === d.name ? null : d.name)}><Text style={[uni.chip, dept === d.name && uni.chipOn]}>{d.name}</Text></Pressable>)}
              </ScrollView>
            ) : null}
            {files.map((f) => <FileRow key={f.id} file={f} showCourse />)}
            {files.length === 0 ? <Text style={uni.empty}>Nothing matches those filters.</Text> : null}
          </>
        )}
        <View style={{ height: 20 }} />
      </ScrollView>
    </SafeAreaView>
  );
}
