import React from 'react';
import styled from '@emotion/styled'

const BlockLink = ({ href, children }) => {
    return (
        <StyledBlockLink href={href}>
            {children}
        </StyledBlockLink>
    );
};

const StyledBlockLink = styled.a`
    width: 100%;
    padding: 15px;
    margin: 20px 0;
    color: var(--ifm-color-primary);
    text-align: left;
    text-decoration: none;
    border-color: #0056b3;
    border-radius: 5px;
    font-size: 18px;
    font-weight: bold;
    transition: background-color 0.3s ease;

    &:hover {
        background-color: #0056b3;
    }
`

export default BlockLink;