import CardSelect from './CardSelect';

// Dropdown wrapper preserving FeedSelect API, backed by the modern CardSelect component
export default function FeedSelect({ value, onChange, options, placeholder, icon }) {
  return (
    <CardSelect
      value={value}
      onChange={onChange}
      options={options}
      placeholder={placeholder}
      icon={icon}
      size="sm"
    />
  );
}
