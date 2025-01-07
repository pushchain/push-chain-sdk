import React, { useState } from 'react';
import { Box, CaretDown, css, Text } from 'shared-components';

type DropdownItem = {
  label: string;
  icon: React.ReactNode;
  value: string;
};

type SelectProps = {
  value: string;
  onSelect: (value: string) => void;
  options: DropdownItem[];
};

const Select: React.FC<SelectProps> = ({ value, onSelect, options }) => {
  const [isOpen, setIsOpen] = useState<boolean>(false);

  const handleSelect = (item: string) => {
    onSelect(item);
    setIsOpen(false);
  };

  return (
    <Box position="relative" width="20%">
      <Box
        width="100%"
        display="flex"
        alignItems="center"
        justifyContent="space-between"
        padding="spacing-xs"
        gap="spacing-xxs"
        border={`border-xmd solid ${
          isOpen ? 'stroke-brand-subtle' : 'stroke-secondary'
        }`}
        borderRadius="radius-xs"
        cursor="pointer"
        className="hover:border-[var(--stroke-tertiary)]"
        onClick={() => setIsOpen((prev) => !prev)}
      >
        {options.find((i) => i.value === value)?.icon}
        <CaretDown />
      </Box>
      {isOpen && (
        <Box
          position="absolute"
          display="flex"
          flexDirection="column"
          width="10rem"
          padding="spacing-xxs"
          gap="spacing-xs"
          backgroundColor="surface-primary"
          border="border-sm solid stroke-tertiary"
          borderRadius="radius-xs"
          margin="spacing-xs spacing-none spacing-none spacing-none"
          className="shadow-lg"
          css={css`
            right: 0px;
          `}
        >
          {options.map((item) => (
            <Box
              key={item.label}
              display="flex"
              alignItems="center"
              padding="spacing-xxs"
              borderRadius="radius-xs"
              cursor="pointer"
              className="hover:bg-gray-100"
              onClick={() => handleSelect(item.value)}
            >
              <Box margin="spacing-none spacing-xxs spacing-none spacing-none">
                {item.icon}
              </Box>
              <Text variant="bs-regular">{item.label}</Text>
            </Box>
          ))}
        </Box>
      )}
    </Box>
  );
};

export { Select };

export type { SelectProps, DropdownItem };
