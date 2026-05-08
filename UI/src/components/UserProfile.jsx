import { useState, useEffect, useMemo } from 'react';
import { ArrowLeft, Save, User2Icon, Mail, Phone, BookOpen, GraduationCap, Calendar, Hash, Brain, Sliders, ListOrdered } from 'lucide-react';
import { supabase } from '../supabaseClient';
import MemoryManagement from './MemoryManagement';
import BehaviorSettings from './BehaviorSettings';
import PrioritySettings from './PrioritySettings';
import { DEFAULT_BEHAVIOR } from '../services/behaviorService';

export default function UserProfile({ onBack, user, behaviorSettings, onUpdateBehavior, autoBehavior }) {
  // At the global-profile scope there is no live conversation to auto-adapt to,
  // so the "auto" baseline falls back to DEFAULT_BEHAVIOR. Manual overrides
  // (behaviorSettings) are merged on top for display.
  const autoBaseline = useMemo(() => autoBehavior || DEFAULT_BEHAVIOR, [autoBehavior]);
  const manualOverrides = useMemo(() => behaviorSettings || {}, [behaviorSettings]);
  const effectiveSettings = useMemo(
    () => ({ ...autoBaseline, ...manualOverrides }),
    [autoBaseline, manualOverrides]
  );
  const [formData, setFormData] = useState({
    firstName: '',
    lastName: '',
    sjsuId: '',
    email: '',
    phone: '',
    major: '',
    minor: '',
    expectedGraduation: '',
    year: 'Freshman',
    gpa: '',
  });

  const [saved, setSaved] = useState(false);
  const [_loadingProfile, setLoadingProfile] = useState(true);
  const [activeTab, setActiveTab] = useState('profile'); // 'profile' | 'personalization'
  const [personalSection, setPersonalSection] = useState('style'); // 'style' | 'priorities' | 'memory'

  // Load profile from Supabase on mount
  useEffect(() => {
    async function fetchProfile() {
      if (!user?.id) { setLoadingProfile(false); return; }
      const { data } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .single();
      if (data) {
        const nameParts = (data.full_name || '').split(' ');
        setFormData({
          firstName: nameParts[0] || '',
          lastName: nameParts.slice(1).join(' ') || '',
          sjsuId: data.university_id || '',
          email: data.email || '',
          phone: data.phone || '',
          major: data.major || '',
          minor: data.minor || '',
          expectedGraduation: data.graduation_year ? `${data.graduation_year}-05` : '',
          year: data.class_standing || 'Freshman',
          gpa: data.gpa ?? '',
        });
      }
      setLoadingProfile(false);
    }
    fetchProfile();
  }, [user]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
    setSaved(false);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const gradYear = formData.expectedGraduation
      ? parseInt(formData.expectedGraduation.split('-')[0], 10)
      : null;
    const { error } = await supabase
      .from('profiles')
      .update({
        full_name: `${formData.firstName} ${formData.lastName}`.trim(),
        university_id: formData.sjsuId || null,
        phone: formData.phone || null,
        major: formData.major || null,
        minor: formData.minor || null,
        graduation_year: gradYear,
        class_standing: formData.year,
        gpa: formData.gpa ? parseFloat(formData.gpa) : null,
      })
      .eq('id', user.id);
    if (!error) {
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    }
  };

  const inputClass =
    "w-full bg-bg-surface border border-border-color rounded-lg px-4 py-3 text-base text-text-primary placeholder-text-secondary focus:outline-none focus:ring-2 focus:ring-sjsu-gold/40 focus:border-sjsu-gold transition-all";

  const labelClass = "block text-sm font-semibold text-text-secondary mb-1.5 uppercase tracking-wide";

  return (
    <div className="flex-1 flex flex-col bg-bg-main overflow-y-auto transition-colors duration-300">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-bg-main/80 backdrop-blur-md border-b border-border-color px-8 py-5 flex items-center gap-4">
        <button
          onClick={onBack}
          className="p-2 rounded-lg hover:bg-bg-hover transition-colors text-text-secondary hover:text-text-primary"
          title="Back to Chat"
        >
          <ArrowLeft size={20} />
        </button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-text-primary">Settings</h1>
          <p className="text-sm text-text-secondary">Manage your profile, behavior, and memory</p>
        </div>
        {/* Tab switcher */}
        <div className="flex items-center bg-bg-surface border border-border-color rounded-lg p-1 gap-1">
          <button
            onClick={() => setActiveTab('profile')}
            className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              activeTab === 'profile'
                ? 'bg-white dark:bg-bg-hover text-text-primary shadow-sm'
                : 'text-text-secondary hover:text-text-primary'
            }`}
          >
            <User2Icon size={15} />
            Profile
          </button>
          <button
            onClick={() => setActiveTab('personalization')}
            className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              activeTab === 'personalization'
                ? 'bg-white dark:bg-bg-hover text-text-primary shadow-sm'
                : 'text-text-secondary hover:text-text-primary'
            }`}
          >
            <Sliders size={15} />
            Personalization
          </button>
        </div>
      </div>

      {/* Body */}
      {activeTab === 'personalization' ? (
        <div className="flex-1 flex overflow-hidden">
          {/* Left nav */}
          <nav className="w-56 shrink-0 border-r border-border-color bg-bg-surface/50 py-6 px-3 space-y-1 overflow-y-auto">
            <button
              onClick={() => setPersonalSection('style')}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                personalSection === 'style'
                  ? 'bg-sjsu-gold/10 text-sjsu-gold'
                  : 'text-text-secondary hover:text-text-primary hover:bg-bg-hover'
              }`}
            >
              <Sliders size={16} />
              Response Style
            </button>
            <button
              onClick={() => setPersonalSection('priorities')}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                personalSection === 'priorities'
                  ? 'bg-sjsu-gold/10 text-sjsu-gold'
                  : 'text-text-secondary hover:text-text-primary hover:bg-bg-hover'
              }`}
            >
              <ListOrdered size={16} />
              Priorities
            </button>
            <button
              onClick={() => setPersonalSection('memory')}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                personalSection === 'memory'
                  ? 'bg-sjsu-gold/10 text-sjsu-gold'
                  : 'text-text-secondary hover:text-text-primary hover:bg-bg-hover'
              }`}
            >
              <Brain size={16} />
              Memory
            </button>
          </nav>

          {/* Right content */}
          <div className="flex-1 overflow-y-auto">
            <div className="max-w-2xl mx-auto px-8 py-8">
              {personalSection === 'style' ? (
                <>
                  <div className="mb-6">
                    <h2 className="text-lg font-bold text-text-primary">Response Style</h2>
                    <p className="text-sm text-text-secondary mt-0.5">Control how SJSU Copilot writes its responses</p>
                  </div>
                  <BehaviorSettings
                    settings={effectiveSettings}
                    autoBehavior={autoBaseline}
                    manualOverrides={manualOverrides}
                    onUpdate={onUpdateBehavior}
                  />
                </>
              ) : personalSection === 'priorities' ? (
                <>
                  <div className="mb-6">
                    <h2 className="text-lg font-bold text-text-primary">Priorities</h2>
                    <p className="text-sm text-text-secondary mt-0.5">What Copilot optimizes for when tradeoffs appear</p>
                  </div>
                  <PrioritySettings
                    stack={effectiveSettings.priority_stack}
                    onUpdate={onUpdateBehavior}
                  />
                </>
              ) : (
                <>
                  <div className="mb-6">
                    <h2 className="text-lg font-bold text-text-primary">Memory</h2>
                    <p className="text-sm text-text-secondary mt-0.5">Review and manage what Copilot remembers about you</p>
                  </div>
                  <MemoryManagement user={user} />
                </>
              )}
            </div>
          </div>
        </div>
      ) : (
      /* Form */
      <div className="flex-1 flex justify-center px-8 py-10">
        <form onSubmit={handleSubmit} className="w-full max-w-2xl space-y-8">
          
          {/* Avatar Section */}
          <div className="flex items-center gap-6 pb-6 border-b border-border-color">
            <div className="w-20 h-20 rounded-full bg-gradient-to-br from-sjsu-gold to-orange-400 flex items-center justify-center shrink-0 shadow-lg">
              <User2Icon size={36} className="text-white" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-text-primary">
                {formData.firstName || formData.lastName
                  ? `${formData.firstName} ${formData.lastName}`.trim()
                  : 'Your Name'}
              </h2>
              <p className="text-sm text-text-secondary">
                {formData.email || 'your.email@sjsu.edu'}
              </p>
            </div>
          </div>

          {/* Personal Information */}
          <div>
            <h3 className="text-lg font-bold text-text-primary mb-4 flex items-center gap-2">
              <User2Icon size={18} className="text-sjsu-gold" />
              Personal Information
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <div>
                <label className={labelClass}>First Name</label>
                <input
                  type="text"
                  name="firstName"
                  value={formData.firstName}
                  onChange={handleChange}
                  placeholder="John"
                  className={inputClass}
                  required
                />
              </div>
              <div>
                <label className={labelClass}>Last Name</label>
                <input
                  type="text"
                  name="lastName"
                  value={formData.lastName}
                  onChange={handleChange}
                  placeholder="Doe"
                  className={inputClass}
                  required
                />
              </div>
              <div>
                <label className={labelClass}>SJSU Student ID</label>
                <div className="relative">
                  <Hash size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary" />
                  <input
                    type="text"
                    name="sjsuId"
                    value={formData.sjsuId}
                    onChange={handleChange}
                    placeholder="012345678"
                    className={`${inputClass} pl-10`}
                    maxLength={9}
                    required
                  />
                </div>
              </div>
              <div>
                <label className={labelClass}>Phone Number</label>
                <div className="relative">
                  <Phone size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary" />
                  <input
                    type="tel"
                    name="phone"
                    value={formData.phone}
                    onChange={handleChange}
                    placeholder="(408) 555-1234"
                    className={`${inputClass} pl-10`}
                  />
                </div>
              </div>
              <div className="md:col-span-2">
                <label className={labelClass}>SJSU Email</label>
                <div className="relative">
                  <Mail size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary" />
                  <input
                    type="email"
                    name="email"
                    value={formData.email}
                    onChange={handleChange}
                    placeholder="john.doe@sjsu.edu"
                    className={`${inputClass} pl-10`}
                    required
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Academic Information */}
          <div>
            <h3 className="text-lg font-bold text-text-primary mb-4 flex items-center gap-2">
              <GraduationCap size={18} className="text-sjsu-gold" />
              Academic Information
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <div>
                <label className={labelClass}>Major</label>
                <div className="relative">
                  <BookOpen size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary" />
                  <input
                    type="text"
                    name="major"
                    value={formData.major}
                    onChange={handleChange}
                    placeholder="Computer Science"
                    className={`${inputClass} pl-10`}
                    required
                  />
                </div>
              </div>
              <div>
                <label className={labelClass}>Minor (Optional)</label>
                <div className="relative">
                  <BookOpen size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary" />
                  <input
                    type="text"
                    name="minor"
                    value={formData.minor}
                    onChange={handleChange}
                    placeholder="Mathematics"
                    className={`${inputClass} pl-10`}
                  />
                </div>
              </div>
              <div>
                <label className={labelClass}>Year</label>
                <select
                  name="year"
                  value={formData.year}
                  onChange={handleChange}
                  className={inputClass}
                  required
                >
                  <option value="Freshman">Freshman</option>
                  <option value="Sophomore">Sophomore</option>
                  <option value="Junior">Junior</option>
                  <option value="Senior">Senior</option>
                  <option value="Graduate">Graduate</option>
                </select>
              </div>
              <div>
                <label className={labelClass}>GPA</label>
                <input
                  type="number"
                  name="gpa"
                  value={formData.gpa}
                  onChange={handleChange}
                  placeholder="3.50"
                  className={inputClass}
                  min="0"
                  max="4"
                  step="0.01"
                />
              </div>
              <div className="md:col-span-2">
                <label className={labelClass}>Expected Graduation</label>
                <div className="relative">
                  <Calendar size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary" />
                  <input
                    type="month"
                    name="expectedGraduation"
                    value={formData.expectedGraduation}
                    onChange={handleChange}
                    className={`${inputClass} pl-10`}
                    required
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Save Button */}
          <div className="flex items-center gap-4 pt-4 pb-8">
            <button
              type="submit"
              className="flex items-center gap-2 bg-sjsu-gold hover:bg-sjsu-gold-hover text-white font-semibold px-8 py-3 rounded-lg transition-colors shadow-md hover:shadow-lg"
            >
              <Save size={18} />
              Save Profile
            </button>
            {saved && (
              <span className="text-green-600 dark:text-green-400 text-sm font-medium animate-fade-in">
                Profile saved successfully!
              </span>
            )}
          </div>
        </form>
      </div>
      )}
    </div>
  );
}
