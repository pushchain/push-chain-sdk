import React from 'react';
import { useDarkMode } from '../common/hooks';
import { MdOutlineLightMode } from "react-icons/md";
import { MdOutlineDarkMode } from "react-icons/md";
import { Box } from 'shared-components';

const Navbar = () => {
    const { isDarkMode, enable, disable } = useDarkMode();

    return (
        <Box
            display='flex'
            justifyContent='end'
        >
            {!isDarkMode ? (
                <Box
                    border='border-sm solid stroke-tertiary'
                    padding='spacing-xxs'
                    borderRadius='radius-sm'
                    onClick={enable}>
                    <MdOutlineDarkMode size={28} />
                </Box>
            ) : (
                <Box
                    border='border-sm solid stroke-tertiary'
                    padding='spacing-xxs'
                    borderRadius='radius-sm'
                    onClick={disable}>
                    <MdOutlineLightMode color='white' size={28} />
                </Box>
            )}
        </Box>
    );
};

export default Navbar;