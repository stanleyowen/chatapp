import React from 'react';

import closeIcon from '../../icons/closeIcon.png';
import onlineIcon from '../../icons/onlineIcon.png';

import './InfoBar.css';

const InfoBar = ({ room }) => (
    <div className="infoBar" title="Room">
        <div className="leftInnerContainer">
            <img className="onlineIcon" src={onlineIcon} alt="online"/>
            <h3>{room}</h3>
        </div>
        <div className="rightInnerContainer" title="Logout">
            <a href="/"><img src={closeIcon} alt="close"/></a>
        </div>
    </div>
);

export default InfoBar;