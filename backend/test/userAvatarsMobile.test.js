const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const mobileRequire = createRequire(path.join(__dirname, '../../mobile/package.json'));
const babel = mobileRequire('@babel/core');

// Exercise event handlers/state without adding a test-renderer dependency.
function component(file, mocks = {}) {
  const values = []; let cursor = 0;
  const cleanups = [];
  const react = {
    useState(initial) { const index = cursor++; if (!(index in values)) values[index] = initial;
      return [values[index], next => { values[index] = typeof next === 'function' ? next(values[index]) : next; }]; },
    useRef(initial) { const index = cursor++; if (!(index in values)) values[index] = { current: initial }; return values[index]; },
    useEffect(effect) { const index = cursor++; if (!(index in values)) { values[index] = true; cleanups.push(effect()); } },
  };
  const filename = path.join(__dirname, '../../mobile/src/components', file);
  function loadLocal(filename) {
  const source = babel.transformSync(fs.readFileSync(filename, 'utf8'), {
    filename, babelrc: false, configFile: false, presets: [mobileRequire.resolve('babel-preset-expo')],
  }).code;
  const module = { exports: {} };
  vm.runInNewContext(source, { module, exports: module.exports, require: name => {
    if (name in mocks) return mocks[name];
    if (name === 'react') return react;
    if (name === 'react-native') return { ...Object.fromEntries(['Image','Text','View','TouchableOpacity','ActivityIndicator','TextInput','ScrollView'].map(x=>[x,x])), StyleSheet: { create: value => value } };
    if (name === '../theme/appTheme') return { colors: {}, fonts: {}, radius: {}, fontSize: {}, spacing: {}, control: {} };
    if (name === '../i18n/useTranslation') return { useTranslation: () => ({ t: key => key }) };
    if (name === './UserAvatar') return () => null;
    if (name.startsWith('.')) return loadLocal(path.resolve(path.dirname(filename), name + '.js'));
    return mobileRequire(name);
  } });
  return module.exports;
  }
  const loaded = loadLocal(filename);
  return { render(props) { cursor = 0; return loaded.default(props); }, unmount() { cleanups.forEach(fn => fn?.()); } };
}
function find(tree, type) {
  if (!tree || typeof tree !== 'object') return null;
  if (tree.type === type) return tree;
  for (const child of [tree.props?.children].flat(Infinity)) { const result = find(child, type); if (result) return result; }
  return null;
}

test('profile upload stages hosted URL only after success; duplicate taps, failure, cancellation and unmount are safe', async () => {
  let resolveUpload, rejectUpload, picks = 0;
  let canceled = false;
  const field = component('ProfilePhotoField.js', {
    'expo-image-picker': { launchImageLibraryAsync: async () => { picks++; return canceled ? { canceled: true } : { assets: [{ uri: 'local-file' }] }; } },
    '../lib/cloudinary': { uploadToCloudinary: () => new Promise((resolve,reject) => { resolveUpload=resolve; rejectUpload=reject; }) },
  });
  const states=[], urls=[];
  const props={user:{full_name:'Farmer'},value:'old-url',onChange:url=>urls.push(url),onStateChange:state=>states.push(state)};
  const tap=()=>find(field.render(props),'TouchableOpacity').props.onPress();
  const operation=tap(); await Promise.resolve();
  assert.equal(states.at(-1),'uploading'); assert.deepEqual(urls,[]);
  assert.equal(find(field.render(props),'TouchableOpacity').props.disabled,true);
  await tap(); assert.equal(picks,1);
  resolveUpload('hosted-photo'); await operation;
  assert.deepEqual(urls,['hosted-photo']); assert.equal(states.at(-1),'ready');
  const failed=tap(); await Promise.resolve(); rejectUpload(new Error('network')); await failed;
  assert.equal(states.at(-1),'error'); assert.deepEqual(urls,['hosted-photo']);
  canceled=true; await tap(); assert.equal(states.at(-1),'error');
  canceled=false; const retry=tap(); await Promise.resolve(); resolveUpload('replacement'); await retry;
  assert.equal(states.at(-1),'ready'); assert.deepEqual(urls,['hosted-photo','replacement']);
  const abandoned=tap(); await Promise.resolve(); field.unmount(); resolveUpload('abandoned'); await abandoned;
  assert.deepEqual(urls,['hosted-photo','replacement']);
});

test('avatar renders initials without a URL, falls back on image failure and accepts a replacement', () => {
  const avatar=component('UserAvatar.js', { './RemoteImage': 'RemoteImage' });
  assert.equal(find(avatar.render({user:{full_name:'Farmer'}}),'Text').props.children,'F');
  let tree=avatar.render({user:{full_name:'Farmer',avatar_url:'photo1'}});
  assert.equal(find(tree,'RemoteImage').props.uri,'photo1');
  find(tree,'RemoteImage').props.onError();
  tree=avatar.render({user:{full_name:'Farmer',avatar_url:'photo1'}});
  assert.equal(find(tree,'Text').props.children,'F');
  tree=avatar.render({user:{full_name:'Farmer',avatar_url:'photo2'}});
  assert.equal(find(tree,'RemoteImage').props.uri,'photo2');
});

test('Edit Profile blocks Save during upload/failure, persists staged URL and refreshes shared profile', async () => {
  const writes=[], alerts=[]; let refreshes=0;
  const screen=component('../screens/EditProfileScreen.js', {
    '../lib/responsive':{rf:x=>x},
    '../components/ProfilePhotoField':'ProfilePhotoField',
    '../components/MapPinningModal':'MapPinningModal',
    'react-native-safe-area-context':{SafeAreaView:'SafeAreaView'},
    '@expo/vector-icons':{Ionicons:'Ionicons'},
    '../context/AuthContext':{useAuth:()=>({user:{id:'me',full_name:'Farmer',role:'farmer',avatar_url:'old'},updateUser:async()=>{refreshes++;}})},
    '../lib/ui':{showAlert:(...args)=>alerts.push(args)},
    '../api/client':{api:{put:async(route,body)=>{writes.push({route,body});return {user:{...body,id:'me'}};}}},
  });
  const props={navigation:{goBack(){},navigate(){}}};
  const saveButton=tree=>{
    if(!tree||typeof tree!=='object')return null;
    if(tree.type==='TouchableOpacity' && find(tree,'Text')?.props.children==='common.saveChanges')return tree;
    for(const child of [tree.props?.children].flat(Infinity)){const found=saveButton(child);if(found)return found;}
    return null;
  };
  let tree=screen.render(props); const field=find(tree,'ProfilePhotoField');
  field.props.onStateChange('uploading'); tree=screen.render(props);
  assert.equal(saveButton(tree).props.disabled,true); await saveButton(tree).props.onPress(); assert.equal(writes.length,0);
  field.props.onStateChange('error'); tree=screen.render(props); assert.equal(saveButton(tree).props.disabled,true);
  field.props.onChange('hosted-new'); field.props.onStateChange('ready'); tree=screen.render(props);
  assert.equal(saveButton(tree).props.disabled,false); await saveButton(tree).props.onPress();
  assert.equal(writes[0].route,'/api/users/me');assert.equal(writes[0].body.avatar_url,'hosted-new');
  assert.equal(refreshes,1); assert.equal(alerts.at(-1)[0],'common.saved');
  await saveButton(screen.render(props)).props.onPress();
  assert.equal(Object.hasOwn(writes[1].body,'avatar_url'),false);
});
